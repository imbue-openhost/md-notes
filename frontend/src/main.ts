import './style.css';
import { createEditor } from './editor/editor';
import { createSidebar, destroySidebar, refreshSidebar, setCurrentFile, setSyncStatus } from './ui/sidebar';
import { onConnectionStatus } from './editor/sync';
import { setApiBaseUrl, createShareLink, listShareLinks, deleteShareLink } from './api/client';
import { setActiveVault, getActiveVault } from './api/vault-ops';
import { isDevServer, isTauri, serverUrl, getShareConfig } from './config';
import { showSettingsModal } from './ui/settings';
import { showVaultPicker } from './ui/vault-picker';
import type { VaultConfig } from './api/types';

import DEFAULT_VIMRC from './default.vimrc?raw';

const app = document.getElementById('app')!;

/** Resolved server URL — updated from Tauri config if running as desktop app. */
let activeServerUrl = serverUrl;
let activeVimrc = DEFAULT_VIMRC;
let editorContainer: HTMLElement;
let currentDocPath: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

if (isDevServer) {
  setApiBaseUrl('http://localhost:8080');
}

// ── Tauri helpers ────────────────────────────────────────────────────────

interface TauriConfig {
  server_url: string;
  vaults: VaultConfig[];
  last_vault_id: string | null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function loadTauriConfig(): Promise<TauriConfig | null> {
  if (!isTauri) return null;
  try {
    const config = await invoke<TauriConfig>('get_config');
    activeServerUrl = config.server_url || '';
    if (activeServerUrl) {
      setApiBaseUrl(activeServerUrl);
    }
    // Load vimrc from ~/.md_notes/.vimrc (created with defaults on first run)
    try {
      activeVimrc = await invoke<string>('get_vimrc');
    } catch { /* fall back to bundled default */ }
    return config;
  } catch {
    return null;
  }
}

// ── Check for share mode ─────────────────────────────────────────────────

const shareConfig = getShareConfig();

if (shareConfig) {
  const editorContainer = document.createElement('div');
  editorContainer.id = 'editor-container';
  app.appendChild(editorContainer);

  createEditor(editorContainer, {
    vimrcContent: activeVimrc,
    syncDocPath: shareConfig.docPath,
    syncServerUrl: activeServerUrl,
    readOnly: shareConfig.permission === 'read',
  });
} else {
  boot().catch((e) => {
    console.error('Boot failed:', e);
    app.textContent = `Boot error: ${e}`;
  });

  // Listen for native menu events
  if (isTauri) {
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('settings', () => handleSettings());
      listen('switch_vault', () => switchVault());
    });
  }
}

// ── Boot flow ────────────────────────────────────────────────────────────

async function boot(): Promise<void> {
  if (isTauri) {
    const config = await loadTauriConfig();
    if (!config) { openVaultPicker([]); return; }

    // Auto-open last vault if available
    if (config.last_vault_id) {
      const vault = config.vaults.find((v) => v.id === config.last_vault_id);
      if (vault) { openVault(vault); return; }
    }

    // Show picker
    openVaultPicker(config.vaults);
  } else {
    // Browser mode — single implicit vault, no picker
    setActiveVault({ id: '', name: 'Files', path: '', sync: true });
    openEditor();
    refreshSidebar().catch(() => {});
  }
}

// ── Vault picker ─────────────────────────────────────────────────────────

function openVaultPicker(vaults: VaultConfig[]): void {
  app.innerHTML = '';
  const picker = showVaultPicker(vaults, {
    onSelect: async (vault) => {
      await invoke('set_last_vault', { id: vault.id });
      openVault(vault);
    },
    onAdd: async (name, path, sync) => {
      try {
        const vault = await invoke<VaultConfig>('add_vault', { name, path, sync });
        openVault(vault);
      } catch (e) {
        alert(`Failed to add vault: ${e}`);
      }
    },
    onRemove: async (id) => {
      try {
        await invoke('remove_vault', { id });
        const config = await loadTauriConfig();
        openVaultPicker(config?.vaults ?? []);
      } catch (e) {
        alert(`Failed to remove vault: ${e}`);
      }
    },
  });
  app.appendChild(picker);
}

// ── Open vault ───────────────────────────────────────────────────────────

function openVault(vault: VaultConfig): void {
  setActiveVault(vault);
  app.innerHTML = '';
  openEditor(vault);
  refreshSidebar().catch(() => {});
}

function switchVault(): void {
  destroySidebar();
  loadTauriConfig().then((config) => {
    openVaultPicker(config?.vaults ?? []);
  });
}

// ── Editor setup ─────────────────────────────────────────────────────────

let unsubSyncStatus: (() => void) | null = null;

function openEditor(vault?: VaultConfig): void {
  editorContainer = document.createElement('div');
  editorContainer.id = 'editor-container';

  const isSync = vault?.sync ?? true;
  const hasRemote = !!activeServerUrl;

  // Clean up previous sync status listener
  unsubSyncStatus?.();
  unsubSyncStatus = null;

  createSidebar(app, {
    onSelect: handleFileSelect,
    onShare: isSync && hasRemote ? handleShare : undefined,
    onSwitchVault: isTauri ? switchVault : undefined,
    onSettings: isTauri ? handleSettings : undefined,
    vaultName: vault?.name,
    showSyncStatus: isSync,
  });

  if (isSync) {
    if (hasRemote) {
      unsubSyncStatus = onConnectionStatus((status) => setSyncStatus(status));
    } else {
      setSyncStatus('no-remote');
    }
  }

  app.appendChild(editorContainer);

  // Start with the sample doc (no sync)
  createEditor(editorContainer, { vimrcContent: DEFAULT_VIMRC });
}

function handleFileSelect(path: string): void {
  currentDocPath = path;
  setCurrentFile(path);

  const vault = getActiveVault();

  if (isTauri && vault) {
    // Desktop app — always read from local disk
    handleFileSelectTauri(path, vault);
  } else {
    // Browser — use Yjs sync only
    createEditor(editorContainer, {
      vimrcContent: activeVimrc,
      syncDocPath: path,
      syncServerUrl: activeServerUrl,
    });
  }
}

async function handleFileSelectTauri(path: string, vault: VaultConfig): Promise<void> {
  try {
    const content = await invoke<string>('read_local_file', {
      vaultPath: vault.path,
      path,
    });

    // Always auto-save to local disk
    const onDocChange = (newContent: string) => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        invoke('write_local_file', {
          vaultPath: vault.path,
          path,
          content: newContent,
        }).catch(() => {});
      }, 1000);
    };

    if (vault.sync && activeServerUrl) {
      // Synced vault with remote configured — local content + Yjs sync
      const syncDocPath = vault.id ? `${vault.id}/${path}` : path;
      createEditor(editorContainer, {
        vimrcContent: activeVimrc,
        initialDoc: content,
        syncDocPath,
        syncServerUrl: activeServerUrl,
        onDocChange,
      });
    } else {
      // Local-only vault
      createEditor(editorContainer, {
        vimrcContent: activeVimrc,
        initialDoc: content,
        onDocChange,
      });
    }
  } catch (e) {
    alert(`Failed to open file: ${e}`);
  }
}

function handleShare(path: string): void {
  showShareModal(path);
}

function handleSettings(): void {
  showSettingsModal(() => {
    loadTauriConfig().then(() => refreshSidebar().catch(() => {}));
  });
}

// ── Share modal ──────────────────────────────────────────────────────────

function showShareModal(path: string): void {
  document.querySelector('.share-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'share-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'share-modal';

  const title = document.createElement('div');
  title.className = 'share-modal-title';
  title.textContent = `Share: ${path.replace(/\.md$/, '')}`;
  modal.appendChild(title);

  const body = document.createElement('div');
  body.className = 'share-modal-body';
  body.textContent = 'Loading...';
  modal.appendChild(body);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);

  renderShareBody(path, body);
}

async function renderShareBody(path: string, body: HTMLElement): Promise<void> {
  body.innerHTML = '';

  // For synced vaults, share links use the vault-prefixed path
  const vault = getActiveVault();
  const serverPath = vault && vault.id ? `${vault.id}/${path}` : path;

  let links;
  try {
    links = await listShareLinks(serverPath);
  } catch (e) {
    body.innerHTML = `<div class="share-modal-error">Failed to load links: ${e}</div>`;
    return;
  }

  // Existing links
  if (links.length > 0) {
    const list = document.createElement('div');
    list.className = 'share-link-list';

    for (const link of links) {
      const url = `${window.location.origin}/share/${link.uuid}`;
      const row = document.createElement('div');
      row.className = 'share-link-row';

      const info = document.createElement('div');
      info.className = 'share-link-info';

      const badge = document.createElement('span');
      badge.className = `share-link-badge ${link.permission === 'write' ? 'share-link-badge-write' : ''}`;
      badge.textContent = link.permission === 'write' ? 'Can edit' : 'View only';
      info.appendChild(badge);

      const date = document.createElement('span');
      date.className = 'share-link-date';
      date.textContent = new Date(link.created_at).toLocaleDateString();
      info.appendChild(date);

      row.appendChild(info);

      const input = document.createElement('input');
      input.className = 'share-modal-link';
      input.type = 'text';
      input.value = url;
      input.readOnly = true;
      input.addEventListener('click', () => input.select());
      row.appendChild(input);

      const actions = document.createElement('div');
      actions.className = 'share-link-actions';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'share-modal-btn share-modal-btn-sm';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
      actions.appendChild(copyBtn);

      const revokeBtn = document.createElement('button');
      revokeBtn.className = 'share-modal-btn share-modal-btn-sm share-modal-btn-danger';
      revokeBtn.textContent = 'Revoke';
      revokeBtn.addEventListener('click', async () => {
        try {
          await deleteShareLink(link.uuid);
          renderShareBody(path, body);
        } catch (e) {
          alert(`Failed to revoke: ${e}`);
        }
      });
      actions.appendChild(revokeBtn);

      row.appendChild(actions);
      list.appendChild(row);
    }
    body.appendChild(list);
  } else {
    const empty = document.createElement('div');
    empty.className = 'share-modal-empty';
    empty.textContent = 'No active share links.';
    body.appendChild(empty);
  }

  // Create new link section
  const newSection = document.createElement('div');
  newSection.className = 'share-new-section';

  const newLabel = document.createElement('div');
  newLabel.className = 'share-modal-label';
  newLabel.textContent = 'Create new link';
  newSection.appendChild(newLabel);

  const newBtns = document.createElement('div');
  newBtns.className = 'share-modal-buttons';

  const readBtn = document.createElement('button');
  readBtn.className = 'share-modal-btn';
  readBtn.textContent = 'View only';
  readBtn.addEventListener('click', async () => {
    await createShareLink(serverPath, 'read');
    renderShareBody(path, body);
  });
  newBtns.appendChild(readBtn);

  const writeBtn = document.createElement('button');
  writeBtn.className = 'share-modal-btn share-modal-btn-primary';
  writeBtn.textContent = 'Can edit';
  writeBtn.addEventListener('click', async () => {
    await createShareLink(serverPath, 'write');
    renderShareBody(path, body);
  });
  newBtns.appendChild(writeBtn);

  newSection.appendChild(newBtns);
  body.appendChild(newSection);
}
