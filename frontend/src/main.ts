import './style.css';
import { createEditor } from './editor/editor';
import { createSidebar, destroySidebar, refreshSidebar, setCurrentFile, setSyncStatus, setSyncStatusText } from './ui/sidebar';
import { createLayout, destroyLayout, openFile, splitPane } from './ui/editor-layout';
import { onConnectionStatus, onConnectionError } from './editor/sync';
import { setApiBaseUrl, setApiKey, createShareLink, listShareLinks, deleteShareLink, listVaults, createVault, deleteVault, getServerApiKey, getServerVimrc, saveServerVimrc } from './api/client';
import { setActiveVault, getActiveVault } from './api/vault-ops';
import { isDevServer, isTauri, serverUrl, getShareConfig } from './config';
import { showSettingsModal } from './ui/settings';
import { showVaultPicker } from './ui/vault-picker';
import type { VaultConfig } from './api/types';
import { syncVault } from './api/sync';
import { parseVimrc } from './editor/vim';

import DEFAULT_VIMRC from './default.vimrc?raw';

const app = document.getElementById('app')!;

/** Resolved server URL — updated from Tauri config if running as desktop app. */
let activeServerUrl = serverUrl;
let activeApiKey = '';
let activeVimrc = DEFAULT_VIMRC;
let currentDocPath: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

if (isDevServer) {
  setApiBaseUrl('http://localhost:8080');
}

// ── Tauri helpers ────────────────────────────────────────────────────────

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

async function loadTauriConfig(): Promise<TauriConfig | null> {
  if (!isTauri) return null;
  try {
    const config = await invoke<TauriConfig>('get_config');
    activeServerUrl = config.server_url || '';
    activeApiKey = config.api_key || '';
    if (activeServerUrl) {
      setApiBaseUrl(activeServerUrl);
    }
    if (activeApiKey) {
      setApiKey(activeApiKey);
    }
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

    if (config.last_vault_id) {
      const vault = config.vaults.find((v) => v.id === config.last_vault_id);
      if (vault) { openVault(vault); return; }
    }

    openVaultPicker(config.vaults);
  } else {
    try {
      const savedVimrc = await getServerVimrc();
      if (savedVimrc) activeVimrc = savedVimrc;
    } catch { /* use default */ }
    try {
      await openWebVaultPicker();
    } catch (e) {
      console.warn('Backend unreachable, opening sample editor:', e);
      openEditor();
    }
  }
}

async function openWebVaultPicker(): Promise<void> {
  let vaults: VaultConfig[] = [];
  try {
    const remote = await listVaults();
    vaults = remote.map((v) => ({ id: v.id, name: v.name, path: '', sync: true }));
  } catch (e) {
    console.error('Failed to load vaults:', e);
  }

  app.innerHTML = '';
  const picker = showVaultPicker(vaults, {
    onSelect: (vault) => openVault(vault),
    onAdd: async (name) => {
      try {
        const created = await createVault(name);
        openVault({ id: created.id, name: created.name, path: '', sync: true });
      } catch (e) {
        alert(`Failed to add vault: ${e}`);
      }
    },
    onRemove: async (id) => {
      try {
        await deleteVault(id);
        await openWebVaultPicker();
      } catch (e) {
        alert(`Failed to remove vault: ${e}`);
      }
    },
  });
  app.appendChild(picker);
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
        if (sync && activeServerUrl) {
          createVault(vault.name, vault.id).catch((e) => {
            console.warn('Failed to register vault with server:', e);
          });
        }
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

  if (vault.sync && activeServerUrl && vault.id) {
    createVault(vault.name, vault.id).catch(() => {});

    if (isTauri && activeApiKey) {
      runFileSync(vault);
    }
  }
}

async function runFileSync(vault: VaultConfig): Promise<void> {
  try {
    await syncVault(vault, (progress) => {
      if (progress.phase === 'done') {
        setSyncStatus('connected');
        refreshSidebar().catch(() => {});
      } else if (progress.phase === 'error') {
        setSyncStatus('error', progress.message);
      } else {
        setSyncStatusText(progress.message);
      }
    });
  } catch (e) {
    setSyncStatus('error', `Sync failed: ${e}`);
  }
}

function switchVault(): void {
  destroySidebar();
  destroyLayout();
  if (isTauri) {
    loadTauriConfig().then((config) => {
      openVaultPicker(config?.vaults ?? []);
    });
  } else {
    openWebVaultPicker().catch((e) => console.error(e));
  }
}

// ── Editor setup ─────────────────────────────────────────────────────────

let unsubSyncStatus: (() => void) | null = null;
let unsubSyncError: (() => void) | null = null;
let lastSyncError: string | null = null;

function openEditor(vault?: VaultConfig): void {
  const isSync = vault?.sync ?? true;
  const hasRemote = !!activeServerUrl;

  unsubSyncStatus?.();
  unsubSyncStatus = null;
  unsubSyncError?.();
  unsubSyncError = null;
  lastSyncError = null;

  createSidebar(app, {
    onSelect: handleFileSelect,
    onShare: isSync && hasRemote ? handleShare : undefined,
    onSwitchVault: switchVault,
    onSettings: isTauri ? handleSettings : handleWebSettings,
    vaultName: vault?.name,
    showSyncStatus: isTauri && isSync,
  });

  if (isTauri && isSync) {
    if (hasRemote) {
      unsubSyncStatus = onConnectionStatus((status) => {
        if (lastSyncError && status !== 'connected') {
          setSyncStatus('error', lastSyncError);
        } else {
          if (status === 'connected') lastSyncError = null;
          setSyncStatus(status);
        }
      });
      unsubSyncError = onConnectionError((message) => {
        lastSyncError = message;
        setSyncStatus('error', message);
      });
    } else {
      setSyncStatus('no-remote');
    }
  }

  const editorArea = document.createElement('div');
  editorArea.id = 'editor-container';
  app.appendChild(editorArea);

  createLayout(editorArea, {
    createEditor: (path, container) => makeEditorForPath(path, container, vault),
    onActiveFileChange: (path) => {
      currentDocPath = path;
      setCurrentFile(path);
    },
  });
}

// Keyboard shortcut for splitting — single global listener
function handleLayoutKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
    e.preventDefault();
    splitPane();
  }
}
document.addEventListener('keydown', handleLayoutKeydown);

function makeEditorForPath(path: string, container: HTMLElement, vault?: VaultConfig) {
  if (isTauri && vault) {
    return makeEditorForPathTauri(path, container, vault);
  }

  const syncDocPath = vault?.id ? `${vault.id}/${path}` : path;
  return createEditor(container, {
    vimrcContent: activeVimrc,
    syncDocPath,
    syncServerUrl: activeServerUrl,
  });
}

function makeEditorForPathTauri(path: string, container: HTMLElement, vault: VaultConfig) {
  // For Tauri, we need to read the file first. Return a placeholder and
  // replace it once the async read completes.
  const placeholder = createEditor(container, { vimrcContent: activeVimrc });

  invoke<string>('read_local_file', { vaultPath: vault.path, path }).then((content) => {
    placeholder.destroy();
    container.innerHTML = '';

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

    let instance;
    if (vault.sync && activeServerUrl) {
      const syncDocPath = vault.id ? `${vault.id}/${path}` : path;
      instance = createEditor(container, {
        vimrcContent: activeVimrc,
        initialDoc: content,
        syncDocPath,
        syncServerUrl: activeServerUrl,
        apiKey: activeApiKey || undefined,
        onDocChange,
      });
    } else {
      instance = createEditor(container, {
        vimrcContent: activeVimrc,
        initialDoc: content,
        onDocChange,
      });
    }

    // Patch the tab's instance so destroy() cleans up correctly.
    // The layout holds a reference to the original placeholder instance;
    // we need to swap it out.
    placeholder.view = instance.view;
    placeholder.destroy = instance.destroy;
  }).catch((e) => {
    container.textContent = `Failed to open file: ${e}`;
  });

  return placeholder;
}

function handleFileSelect(path: string): void {
  openFile(path);
}

function handleShare(path: string): void {
  showShareModal(path);
}

function handleSettings(): void {
  showSettingsModal(() => {
    loadTauriConfig().then(() => {
      const vault = getActiveVault();
      const path = currentDocPath;
      if (vault) {
        destroySidebar();
        destroyLayout();
        openVault(vault);
        if (path) openFile(path);
      } else {
        refreshSidebar().catch(() => {});
      }
    });
  });
}

async function handleWebSettings(): Promise<void> {
  document.querySelector('.settings-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'settings-modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'settings-modal settings-modal-wide';

  const title = document.createElement('div');
  title.className = 'settings-modal-title';
  title.textContent = 'Settings';
  modal.appendChild(title);

  const form = document.createElement('div');
  form.className = 'settings-form';

  // ── API key section ──
  const apiGroup = document.createElement('div');
  apiGroup.className = 'settings-field';

  const apiLabel = document.createElement('label');
  apiLabel.className = 'settings-label';
  apiLabel.textContent = 'API key (for desktop app)';
  apiGroup.appendChild(apiLabel);

  const apiRow = document.createElement('div');
  apiRow.style.display = 'flex';
  apiRow.style.gap = '6px';

  const apiInput = document.createElement('input');
  apiInput.className = 'settings-input';
  apiInput.type = 'password';
  apiInput.readOnly = true;
  apiInput.value = 'Loading...';
  apiRow.appendChild(apiInput);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'share-modal-btn share-modal-btn-sm';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(apiInput.value);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });
  apiRow.appendChild(copyBtn);

  apiGroup.appendChild(apiRow);
  form.appendChild(apiGroup);

  // ── Keyboard shortcuts section ──
  const vimrcGroup = document.createElement('div');
  vimrcGroup.className = 'settings-field';

  const vimrcLabel = document.createElement('label');
  vimrcLabel.className = 'settings-label';
  vimrcLabel.textContent = 'Keyboard shortcuts (vimrc)';
  vimrcGroup.appendChild(vimrcLabel);

  const textarea = document.createElement('textarea');
  textarea.className = 'settings-input settings-vimrc';
  textarea.spellcheck = false;
  textarea.value = 'Loading...';
  vimrcGroup.appendChild(textarea);

  const errorsEl = document.createElement('div');
  errorsEl.className = 'settings-vimrc-errors';
  vimrcGroup.appendChild(errorsEl);

  const vimrcButtons = document.createElement('div');
  vimrcButtons.style.display = 'flex';
  vimrcButtons.style.gap = '6px';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'share-modal-btn share-modal-btn-sm';
  resetBtn.textContent = 'Reset to defaults';
  resetBtn.addEventListener('click', () => {
    textarea.value = DEFAULT_VIMRC;
    validateVimrc(textarea.value, errorsEl);
  });
  vimrcButtons.appendChild(resetBtn);

  vimrcGroup.appendChild(vimrcButtons);
  form.appendChild(vimrcGroup);
  modal.appendChild(form);

  // Validate on input
  textarea.addEventListener('input', () => {
    validateVimrc(textarea.value, errorsEl);
  });

  // ── Bottom buttons ──
  const buttons = document.createElement('div');
  buttons.className = 'settings-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'share-modal-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => overlay.remove());
  buttons.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'share-modal-btn share-modal-btn-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', async () => {
    try {
      await saveServerVimrc(textarea.value);
      activeVimrc = textarea.value;
      overlay.remove();
      // Re-open current file to apply new keybindings
      if (currentDocPath) {
        handleFileSelect(currentDocPath);
      }
    } catch (e) {
      alert(`Failed to save: ${e}`);
    }
  });
  buttons.appendChild(saveBtn);

  modal.appendChild(buttons);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);

  // Load data
  try {
    const key = await getServerApiKey();
    apiInput.value = key || '(no key configured)';
  } catch {
    apiInput.value = '(unavailable)';
  }

  try {
    const saved = await getServerVimrc();
    textarea.value = saved ?? DEFAULT_VIMRC;
    validateVimrc(textarea.value, errorsEl);
  } catch {
    textarea.value = DEFAULT_VIMRC;
  }
}

function validateVimrc(content: string, errorsEl: HTMLElement): void {
  const result = parseVimrc(content);
  if (result.errors.length > 0) {
    errorsEl.textContent = result.errors.join('\n');
    errorsEl.style.display = 'block';
  } else {
    errorsEl.style.display = 'none';
  }
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

  const vault = getActiveVault();
  const serverPath = vault && vault.id ? `${vault.id}/${path}` : path;

  let links;
  try {
    links = await listShareLinks(serverPath);
  } catch (e) {
    body.innerHTML = `<div class="share-modal-error">Failed to load links: ${e}</div>`;
    return;
  }

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

      const inputEl = document.createElement('input');
      inputEl.className = 'share-modal-link';
      inputEl.type = 'text';
      inputEl.value = url;
      inputEl.readOnly = true;
      inputEl.addEventListener('click', () => inputEl.select());
      row.appendChild(inputEl);

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
