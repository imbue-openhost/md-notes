import { createSignal, createResource, onMount, onCleanup, Show, type Component } from 'solid-js';
import { createEditor, type EditorInstance } from './editor/editor';
import {
  createShareLink, listShareLinks, deleteShareLink,
  listVaults, createVault, deleteVault, getServerVimrc, saveServerVimrc,
} from './api/client';
import { setActiveVault, getActiveVault } from './api/vault-ops';
import { serverUrl, getShareUuid, fetchShareInfo, type ShareInfo } from './config';
import type { VaultConfig } from './api/types';
import { VaultPicker } from './components/VaultPicker';
import { Sidebar } from './components/Sidebar';
import { EditorLayout, type EditorLayoutHandle } from './components/EditorLayout';
import { ShareModal } from './components/ShareModal';
import { WebSettingsModal } from './components/SettingsModal';

import DEFAULT_VIMRC from './default.vimrc?raw';

const ShareEditor: Component<{ uuid: string; info: ShareInfo }> = (props) => {
  let container!: HTMLDivElement;
  onMount(() => {
    createEditor(container, {
      vimrcContent: DEFAULT_VIMRC,
      shareUuid: props.uuid,
      shareDocPath: props.info.doc_path,
      syncServerUrl: serverUrl,
      readOnly: props.info.permission === 'read',
    });
  });
  return <div ref={container} id="editor-container" />;
};

const ShareView: Component<{ uuid: string }> = (props) => {
  const [info] = createResource(() => props.uuid, fetchShareInfo);
  return (
    <Show
      when={info()}
      fallback={
        info.error
          ? <div style={{ padding: '2rem' }}>Share link not found or revoked.</div>
          : <div style={{ padding: '2rem' }}>Loading…</div>
      }
    >
      {(data) => <ShareEditor uuid={props.uuid} info={data()} />}
    </Show>
  );
};

export const App: Component = () => {
  const shareUuid = getShareUuid();
  if (shareUuid) return <ShareView uuid={shareUuid} />;

  const [activeVimrc, setActiveVimrc] = createSignal(DEFAULT_VIMRC);
  const [vault, setVault] = createSignal<VaultConfig | null>(null);
  const [vaultList, setVaultList] = createSignal<VaultConfig[]>([]);
  const [showVaultPicker, setShowVaultPicker] = createSignal(true);
  const [currentDocPath, setCurrentDocPath] = createSignal<string | null>(null);
  const [shareModalPath, setShareModalPath] = createSignal<string | null>(null);
  const [showWebSettings, setShowWebSettings] = createSignal(false);

  let layoutHandle: EditorLayoutHandle | undefined;

  async function boot() {
    try {
      const saved = await getServerVimrc();
      if (saved) setActiveVimrc(saved);
    } catch {}
    try { await loadWebVaults(); } catch (e) {
      console.warn('Backend unreachable:', e);
      openVault({ name: '', path: '', sync: true });
    }
  }

  async function loadWebVaults() {
    let vaults: VaultConfig[] = [];
    try {
      const remote = await listVaults();
      vaults = remote.map((v) => ({ name: v.name, path: '', sync: true }));
    } catch (e) { console.error('Failed to load vaults:', e); }

    try {
      const lastName = localStorage.getItem('mdnotes-last-vault');
      if (lastName) {
        const match = vaults.find((v) => v.name === lastName);
        if (match) { openVault(match); return; }
      }
    } catch {}

    setVaultList(vaults);
    setShowVaultPicker(true);
  }

  function openVault(v: VaultConfig) {
    setActiveVault(v);
    setVault(v);
    setShowVaultPicker(false);
    if (v.name) {
      try { localStorage.setItem('mdnotes-last-vault', v.name); } catch {}
    }
    if (v.sync && v.name) {
      createVault(v.name).catch(() => {});
    }
  }

  function switchVault() {
    setVault(null);
    loadWebVaults().catch(console.error);
  }

  function handleFileSelect(path: string) {
    layoutHandle?.openFile(path);
  }

  function makeEditorForPath(path: string, container: HTMLElement): EditorInstance {
    const v = vault();
    return createEditor(container, {
      vimrcContent: activeVimrc(),
      syncVault: v?.name || undefined,
      syncFilePath: path,
      syncServerUrl: serverUrl,
    });
  }

  function handleVaultSelect(v: VaultConfig) {
    openVault(v);
  }

  async function handleVaultAdd(name: string, path: string, sync: boolean) {
    const created = await createVault(name);
    openVault({ name: created.name, path: '', sync: true });
  }

  async function handleVaultRemove(name: string) {
    await deleteVault(name);
    await loadWebVaults();
  }

  onMount(() => {
    boot().catch(console.error);

    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        layoutHandle?.splitPane();
      }
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && key === 'h') {
        e.preventDefault();
        e.stopPropagation();
        layoutHandle?.focusGroupLeft();
      }
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        layoutHandle?.focusGroupRight();
      }
      if (e.metaKey && e.ctrlKey && e.shiftKey && key === 'h') {
        e.preventDefault();
        e.stopPropagation();
        layoutHandle?.focusTabLeft();
      }
      if (e.metaKey && e.ctrlKey && e.shiftKey && key === 'l') {
        e.preventDefault();
        e.stopPropagation();
        layoutHandle?.focusTabRight();
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

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
          onShare={setShareModalPath}
          onSwitchVault={switchVault}
          onSettings={() => setShowWebSettings(true)}
          currentPath={currentDocPath()}
        />

        <EditorLayout
          ref={(h) => { layoutHandle = h; }}
          createEditor={makeEditorForPath}
          onActiveFileChange={setCurrentDocPath}
          vaultName={vault()!.name}
        />
      </Show>

      <Show when={shareModalPath()}>
        <ShareModal
          path={shareModalPath()!}
          vaultName={vault()?.name}
          onClose={() => setShareModalPath(null)}
        />
      </Show>

      <Show when={showWebSettings()}>
        <WebSettingsModal onClose={() => setShowWebSettings(false)} />
      </Show>
    </>
  );
};
