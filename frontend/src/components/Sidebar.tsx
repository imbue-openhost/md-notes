import { createSignal, createResource, For, Show, onMount, onCleanup, type Component } from 'solid-js';
import { ContextMenu, DropdownMenu } from '@kobalte/core';
import type { FileEntry, VaultConfig } from '../api/types';
import { listFiles, createFile, deleteFile, renameFile } from '../api/vault-ops';
import { InputDialog } from './InputDialog';

export type SyncStatus = 'connected' | 'disconnected' | 'connecting' | 'no-remote' | 'error' | 'syncing';
export type BackendStatus = 'connected' | 'disconnected' | 'unauthorized';

interface Props {
  vaultName?: string;
  vaults?: VaultConfig[];
  onSelect: (path: string) => void;
  onShare?: (path: string) => void;
  onSwitchToVault?: (v: VaultConfig) => void;
  onManageVaults?: () => void;
  onRefreshVaults?: () => void;
  onSettings?: () => void;
  showSyncStatus?: boolean;
  syncStatus?: SyncStatus;
  syncErrorMsg?: string;
  backendStatus?: BackendStatus;
  currentPath: string | null;
}

const SYNC_LABELS: Record<string, string> = {
  connected: 'Synced',
  disconnected: 'Offline',
  connecting: 'Connecting...',
  'no-remote': 'No remote configured',
  error: 'Connection error (click for details)',
  syncing: 'Syncing files...',
};

const BACKEND_LABELS: Record<BackendStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  unauthorized: 'Not logged in',
};

export const Sidebar: Component<Props> = (props) => {
  const [files, { refetch }] = createResource(listFiles);
  const [dialog, setDialog] = createSignal<{ label: string; defaultValue?: string; resolve: (v: string | null) => void } | null>(null);

  function showInputDialog(label: string, defaultValue = ''): Promise<string | null> {
    return new Promise((resolve) => setDialog({ label, defaultValue, resolve }));
  }

  async function handleNewFile() {
    const name = await showInputDialog('File name (e.g., note.md)');
    if (!name) return;
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    try {
      await createFile(fileName);
      refetch();
      props.onSelect(fileName);
    } catch (e) { alert(`Failed to create file: ${e}`); }
  }

  async function handleNewFileInDir(dirPath: string) {
    const name = await showInputDialog('File name (e.g., note.md)');
    if (!name) return;
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const fullPath = `${dirPath}/${fileName}`;
    try {
      await createFile(fullPath);
      refetch();
      props.onSelect(fullPath);
    } catch (e) { alert(`Failed to create file: ${e}`); }
  }

  async function handleRename(path: string, name: string) {
    const newName = await showInputDialog('New name', name);
    if (!newName || newName === name) return;
    const parts = path.split('/');
    parts[parts.length - 1] = newName.endsWith('.md') ? newName : `${newName}.md`;
    const newPath = parts.join('/');
    try {
      await renameFile(path, newPath);
      refetch();
      if (props.currentPath === path) props.onSelect(newPath);
    } catch (e) { alert(`Failed to rename: ${e}`); }
  }

  async function handleDelete(path: string, name: string) {
    const confirmed = await showInputDialog(`Type "delete" to confirm deleting "${name}"`);
    if (confirmed !== 'delete') return;
    try {
      await deleteFile(path);
      refetch();
    } catch (e) { alert(`Failed to delete: ${e}`); }
  }

  function FileTreeItem(entry: FileEntry) {
    if (entry.type === 'dir') return <FolderItem entry={entry} />;
    return <FileItem entry={entry} />;
  }

  const FolderItem: Component<{ entry: FileEntry }> = (p) => {
    const [open, setOpen] = createSignal(false);
    return (
      <li classList={{ open: open() }}>
        <ContextMenu.Root>
          <ContextMenu.Trigger as="div" class="sidebar-item" data-path={p.entry.path} data-type="dir" onClick={() => setOpen(!open())}>
            <span class="sidebar-arrow">{open() ? '\u25BC' : '\u25B6'}</span>
            <span>{p.entry.name}</span>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content class="sidebar-context-menu">
              <ContextMenu.Item class="sidebar-context-item" onSelect={() => handleNewFileInDir(p.entry.path)}>
                New file here...
              </ContextMenu.Item>
              <ContextMenu.Item class="sidebar-context-item" onSelect={() => handleDelete(p.entry.path, p.entry.name)}>
                Delete folder
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        <Show when={p.entry.children && p.entry.children.length > 0}>
          <ul class="sidebar-children">
            <For each={p.entry.children!}>{(child) => FileTreeItem(child)}</For>
          </ul>
        </Show>
      </li>
    );
  };

  const FileItem: Component<{ entry: FileEntry }> = (p) => {
    return (
      <li>
        <ContextMenu.Root>
          <ContextMenu.Trigger
            as="div"
            class="sidebar-item"
            classList={{ active: p.entry.path === props.currentPath }}
            data-path={p.entry.path}
            data-type="file"
            onClick={() => props.onSelect(p.entry.path)}
          >
            <span class="sidebar-icon">{'\uD83D\uDCC4'}</span>
            <span>{p.entry.name.replace(/\.md$/, '')}</span>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content class="sidebar-context-menu">
              <ContextMenu.Item class="sidebar-context-item" onSelect={() => handleRename(p.entry.path, p.entry.name)}>
                Rename...
              </ContextMenu.Item>
              <ContextMenu.Item class="sidebar-context-item" onSelect={() => handleDelete(p.entry.path, p.entry.name)}>
                Delete
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </li>
    );
  };

  return (
    <>
      <div id="sidebar">
        <div class="sidebar-header">
          <DropdownMenu.Root
            onOpenChange={(open) => { if (open) props.onRefreshVaults?.(); }}
          >
            <DropdownMenu.Trigger class="sidebar-vault-trigger" title="Switch vault">
              <span class="sidebar-vault-name">{props.vaultName || 'No vault'}</span>
              <span class="sidebar-vault-chevron" aria-hidden>{'⌄'}</span>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content class="sidebar-vault-menu">
                <For each={props.vaults ?? []}>
                  {(v) => (
                    <DropdownMenu.Item
                      class="sidebar-vault-item"
                      onSelect={() => {
                        if (v.name !== props.vaultName) props.onSwitchToVault?.(v);
                      }}
                    >
                      <span class="sidebar-vault-check">
                        {v.name === props.vaultName ? '✓' : ''}
                      </span>
                      <span>{v.name}</span>
                    </DropdownMenu.Item>
                  )}
                </For>
                <Show when={(props.vaults?.length ?? 0) > 0}>
                  <DropdownMenu.Separator class="sidebar-vault-sep" />
                </Show>
                <DropdownMenu.Item
                  class="sidebar-vault-item sidebar-vault-manage"
                  onSelect={() => props.onManageVaults?.()}
                >
                  <span class="sidebar-vault-check" />
                  <span>Manage vaults...</span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <div class="sidebar-header-buttons">
            <button class="sidebar-btn" title="New file" onClick={handleNewFile}>+</button>
            <Show when={props.onSettings}>
              <button class="sidebar-btn" title="Settings" onClick={props.onSettings}>{'⚙️'}</button>
            </Show>
            <Show when={props.onShare}>
              <button
                class="sidebar-btn sidebar-btn-text"
                title="Share current file"
                onClick={() => {
                  if (props.currentPath) props.onShare!(props.currentPath);
                  else alert('Open a file first.');
                }}
              >Share</button>
            </Show>
          </div>
        </div>

        <div class="sidebar-tree">
          <Show when={files()} fallback={<div class="sidebar-error">Loading...</div>}>
            <ul>
              <For each={files()!}>{(entry) => FileTreeItem(entry)}</For>
            </ul>
          </Show>
        </div>

        <Show when={props.showSyncStatus}>
          <div
            class="sidebar-sync-status"
            title={props.syncErrorMsg ?? ''}
            style={props.syncStatus === 'error' ? { cursor: 'pointer' } : {}}
            onClick={() => { if (props.syncStatus === 'error' && props.syncErrorMsg) alert(props.syncErrorMsg); }}
          >
            <span class="sidebar-sync-dot" data-status={props.syncStatus ?? 'disconnected'} />
            <span>{SYNC_LABELS[props.syncStatus ?? 'disconnected'] ?? props.syncStatus}</span>
          </div>
        </Show>

        <Show when={props.backendStatus}>
          <div class="sidebar-sync-status">
            <span class="sidebar-sync-dot" data-status={props.backendStatus} />
            <span>{BACKEND_LABELS[props.backendStatus!]}</span>
          </div>
        </Show>

      </div>

      <Show when={dialog()}>
        {(d) => (
          <InputDialog
            label={d().label}
            defaultValue={d().defaultValue}
            onResult={(v) => { d().resolve(v); setDialog(null); }}
          />
        )}
      </Show>
    </>
  );
};
