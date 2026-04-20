import { createSignal, onMount, onCleanup, Show, type Component } from 'solid-js';
import { createEditor, type EditorInstance } from './editor/editor';
import { onConnectionStatus, onConnectionError, type ConnectionStatus } from './editor/sync';
import {
  setApiBaseUrl, setApiKey, createShareLink, listShareLinks, deleteShareLink,
  listVaults, createVault, deleteVault, getServerApiKey, getServerVimrc, saveServerVimrc,
} from './api/client';
import { setActiveVault, getActiveVault } from './api/vault-ops';
import { isDevServer, isTauri, serverUrl, getShareConfig } from './config';
import { syncVault } from './api/sync';
import type { VaultConfig } from './api/types';
import { VaultPicker } from './components/VaultPicker';
import { Sidebar, type SyncStatus } from './components/Sidebar';
import { EditorLayout, type EditorLayoutHandle } from './components/EditorLayout';
import { ShareModal } from './components/ShareModal';
import { SettingsModal, WebSettingsModal } from './components/SettingsModal';

import DEFAULT_VIMRC from './default.vimrc?raw';

interface TauriConfig {
  server_url: string;
  api_key: string;
  vaults: VaultConfig[];
  last_vault_id: string | null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

const ShareView: Component = () => {
  const shareConfig = getShareConfig()!;
  let container!: HTMLDivElement;
  onMount(() => {
    createEditor(container, {
      vimrcContent: DEFAULT_VIMRC,
      syncDocPath: shareConfig.docPath,
      syncServerUrl: serverUrl,
      readOnly: shareConfig.permission === 'read',
    });
  });
  return <div ref={container} id="editor-container" />;
};

export const App: Component = () => {
  const shareConfig = getShareConfig();
  if (shareConfig) return <ShareView />;

  const [activeServerUrl, setActiveServerUrl] = createSignal(serverUrl);
  const [activeApiKey, setActiveApiKeyVal] = createSignal('');
  const [activeVimrc, setActiveVimrc] = createSignal(DEFAULT_VIMRC);
  const [vault, setVault] = createSignal<VaultConfig | null>(null);
  const [vaultList, setVaultList] = createSignal<VaultConfig[]>([]);
  const [showVaultPicker, setShowVaultPicker] = createSignal(true);
  const [currentDocPath, setCurrentDocPath] = createSignal<string | null>(null);
  const [syncStatus, setSyncStatusVal] = createSignal<SyncStatus>('disconnected');
  const [syncErrorMsg, setSyncErrorMsg] = createSignal<string | undefined>();
  const [shareModalPath, setShareModalPath] = createSignal<string | null>(null);
  const [showSettings, setShowSettings] = createSignal(false);
  const [showWebSettings, setShowWebSettings] = createSignal(false);

  let layoutHandle: EditorLayoutHandle | undefined;
  let lastSyncError: string | null = null;
  let unsubSyncStatus: (() => void) | null = null;
  let unsubSyncError: (() => void) | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  if (isDevServer) setApiBaseUrl('http://localhost:8080');

  async function loadTauriConfig(): Promise<TauriConfig | null> {
    if (!isTauri) return null;
    try {
      const config = await invoke<TauriConfig>('get_config');
      setActiveServerUrl(config.server_url || '');
      setActiveApiKeyVal(config.api_key || '');
      if (config.server_url) setApiBaseUrl(config.server_url);
      if (config.api_key) setApiKey(config.api_key);
      try { setActiveVimrc(await invoke<string>('get_vimrc')); } catch {}
      return config;
    } catch { return null; }
  }

  async function boot() {
    if (isTauri) {
      const config = await loadTauriConfig();
      if (!config) { setShowVaultPicker(true); return; }
      if (config.last_vault_id) {
        const v = config.vaults.find((v) => v.id === config.last_vault_id);
        if (v) { openVault(v); return; }
      }
      setVaultList(config.vaults);
      setShowVaultPicker(true);
    } else {
      try {
        const saved = await getServerVimrc();
        if (saved) setActiveVimrc(saved);
      } catch {}
      try { await loadWebVaults(); } catch (e) {
        console.warn('Backend unreachable:', e);
        openVault({ id: '', name: '', path: '', sync: true });
      }
    }
  }

  async function loadWebVaults() {
    let vaults: VaultConfig[] = [];
    try {
      const remote = await listVaults();
      vaults = remote.map((v) => ({ id: v.id, name: v.name, path: '', sync: true }));
    } catch (e) { console.error('Failed to load vaults:', e); }
    setVaultList(vaults);
    setShowVaultPicker(true);
  }

  function openVault(v: VaultConfig) {
    setActiveVault(v);
    setVault(v);
    setShowVaultPicker(false);

    unsubSyncStatus?.();
    unsubSyncError?.();
    lastSyncError = null;

    const isSync = v.sync ?? true;
    const hasRemote = !!activeServerUrl();

    if (isTauri && isSync && hasRemote) {
      unsubSyncStatus = onConnectionStatus((status) => {
        if (lastSyncError && status !== 'connected') {
          setSyncStatusVal('error');
          setSyncErrorMsg(lastSyncError);
        } else {
          if (status === 'connected') lastSyncError = null;
          setSyncStatusVal(status as SyncStatus);
          setSyncErrorMsg(undefined);
        }
      });
      unsubSyncError = onConnectionError((message) => {
        lastSyncError = message;
        setSyncStatusVal('error');
        setSyncErrorMsg(message);
      });
    } else if (isTauri && isSync) {
      setSyncStatusVal('no-remote');
    }

    if (v.sync && activeServerUrl() && v.id) {
      createVault(v.name, v.id).catch(() => {});
      if (isTauri && activeApiKey()) runFileSync(v);
    }
  }

  async function runFileSync(v: VaultConfig) {
    try {
      await syncVault(v, (progress) => {
        if (progress.phase === 'done') {
          setSyncStatusVal('connected');
        } else if (progress.phase === 'error') {
          setSyncStatusVal('error');
          setSyncErrorMsg(progress.message);
        }
      });
    } catch (e) {
      setSyncStatusVal('error');
      setSyncErrorMsg(`Sync failed: ${e}`);
    }
  }

  function switchVault() {
    setVault(null);
    if (isTauri) {
      loadTauriConfig().then((config) => {
        setVaultList(config?.vaults ?? []);
        setShowVaultPicker(true);
      });
    } else {
      loadWebVaults().catch(console.error);
    }
  }

  function handleFileSelect(path: string) {
    layoutHandle?.openFile(path);
  }

  function makeEditorForPath(path: string, container: HTMLElement): EditorInstance {
    const v = vault();
    if (isTauri && v) return makeEditorForPathTauri(path, container, v);

    const syncDocPath = v?.id ? `${v.id}/${path}` : path;
    return createEditor(container, {
      vimrcContent: activeVimrc(),
      syncDocPath,
      syncServerUrl: activeServerUrl(),
    });
  }

  function makeEditorForPathTauri(path: string, container: HTMLElement, v: VaultConfig): EditorInstance {
    const placeholder = createEditor(container, { vimrcContent: activeVimrc() });

    invoke<string>('read_local_file', { vaultPath: v.path, path }).then((content) => {
      placeholder.destroy();
      container.innerHTML = '';

      const onDocChange = (newContent: string) => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          invoke('write_local_file', { vaultPath: v.path, path, content: newContent }).catch(() => {});
        }, 1000);
      };

      let instance: EditorInstance;
      if (v.sync && activeServerUrl()) {
        const syncDocPath = v.id ? `${v.id}/${path}` : path;
        instance = createEditor(container, {
          vimrcContent: activeVimrc(),
          initialDoc: content,
          syncDocPath,
          syncServerUrl: activeServerUrl(),
          apiKey: activeApiKey() || undefined,
          onDocChange,
        });
      } else {
        instance = createEditor(container, {
          vimrcContent: activeVimrc(),
          initialDoc: content,
          onDocChange,
        });
      }
      placeholder.view = instance.view;
      placeholder.destroy = instance.destroy;
    }).catch((e) => {
      container.textContent = `Failed to open file: ${e}`;
    });

    return placeholder;
  }

  function handleVaultSelect(v: VaultConfig) {
    if (isTauri) invoke('set_last_vault', { id: v.id }).catch(() => {});
    openVault(v);
  }

  async function handleVaultAdd(name: string, path: string, sync: boolean) {
    if (isTauri) {
      const v = await invoke<VaultConfig>('add_vault', { name, path, sync });
      if (sync && activeServerUrl()) {
        createVault(v.name, v.id).catch(() => {});
      }
      openVault(v);
    } else {
      const created = await createVault(name);
      openVault({ id: created.id, name: created.name, path: '', sync: true });
    }
  }

  async function handleVaultRemove(id: string) {
    if (isTauri) {
      await invoke('remove_vault', { id });
      const config = await loadTauriConfig();
      setVaultList(config?.vaults ?? []);
    } else {
      await deleteVault(id);
      await loadWebVaults();
    }
  }

  function handleSettingsSaved() {
    setShowSettings(false);
    loadTauriConfig().then(() => {
      const v = getActiveVault();
      if (v) openVault(v);
    });
  }

  onMount(() => {
    boot().catch(console.error);
    if (isTauri) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('settings', () => setShowSettings(true));
        listen('switch_vault', () => switchVault());
      });
    }

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        layoutHandle?.splitPane();
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  onCleanup(() => {
    unsubSyncStatus?.();
    unsubSyncError?.();
  });

  const isSync = () => vault()?.sync ?? true;
  const hasRemote = () => !!activeServerUrl();

  return (
    <>
      <Show when={showVaultPicker() && !vault()}>
        <VaultPicker
          vaults={vaultList()}
          onSelect={handleVaultSelect}
          onAdd={handleVaultAdd}
          onRemove={handleVaultRemove}
        />
      </Show>

      <Show when={vault()}>
        <Sidebar
          vaultName={vault()!.name}
          onSelect={handleFileSelect}
          onShare={isSync() && hasRemote() ? setShareModalPath : undefined}
          onSwitchVault={switchVault}
          onSettings={() => isTauri ? setShowSettings(true) : setShowWebSettings(true)}
          showSyncStatus={isTauri && isSync()}
          syncStatus={syncStatus()}
          syncErrorMsg={syncErrorMsg()}
          currentPath={currentDocPath()}
        />

        <EditorLayout
          ref={(h) => { layoutHandle = h; }}
          createEditor={makeEditorForPath}
          onActiveFileChange={setCurrentDocPath}
        />
      </Show>

      <Show when={shareModalPath()}>
        <ShareModal
          path={shareModalPath()!}
          vaultId={vault()?.id}
          onClose={() => setShareModalPath(null)}
        />
      </Show>

      <Show when={showSettings()}>
        <SettingsModal onSaved={handleSettingsSaved} onClose={() => setShowSettings(false)} />
      </Show>

      <Show when={showWebSettings()}>
        <WebSettingsModal onClose={() => setShowWebSettings(false)} />
      </Show>
    </>
  );
};
