import { createSignal, For, Show, type Component } from 'solid-js';
import { ContextMenu, DropdownMenu } from '@kobalte/core';
import type { FileEntry } from '../../api/types';
import type { FileOps } from './file-ops';

interface Props {
  ops: FileOps;
  currentPath: string | null;
  onSelect: (path: string) => void;
  /** Per-row "⋯" menus for file actions — iOS Safari has no long-press
   * path to the right-click context menus (which are always present). */
  rowMenus?: boolean;
  /** Hide all mutating actions (read-only remote vaults). */
  readOnly?: boolean;
}

export const FileTree: Component<Props> = (props) => {
  function FileTreeItem(entry: FileEntry) {
    if (entry.type === 'dir') return <FolderItem entry={entry} />;
    return <FileItem entry={entry} />;
  }

  const RowMenu: Component<{ items: { label: string; action: () => void }[] }> = (p) => (
    <Show when={props.rowMenus && !props.readOnly}>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="sidebar-row-menu-btn"
          title="Actions"
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >⋯</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="sidebar-context-menu">
            <For each={p.items}>
              {(item) => (
                <DropdownMenu.Item class="sidebar-context-item" onSelect={item.action}>
                  {item.label}
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </Show>
  );

  const FolderItem: Component<{ entry: FileEntry }> = (p) => {
    const [open, setOpen] = createSignal(false);
    return (
      <li classList={{ open: open() }}>
        <ContextMenu.Root>
          <ContextMenu.Trigger as="div" class="sidebar-item" data-path={p.entry.path} data-type="dir" onClick={() => setOpen(!open())}>
            <span class="sidebar-arrow">{open() ? '▼' : '▶'}</span>
            <span class="sidebar-item-name">{p.entry.name}</span>
            <RowMenu items={[
              { label: 'New file here...', action: () => props.ops.newFileInDir(p.entry.path) },
              { label: 'Delete folder', action: () => props.ops.remove(p.entry.path, p.entry.name) },
            ]} />
          </ContextMenu.Trigger>
          <Show when={!props.readOnly}>
            <ContextMenu.Portal>
              <ContextMenu.Content class="sidebar-context-menu">
                <ContextMenu.Item class="sidebar-context-item" onSelect={() => props.ops.newFileInDir(p.entry.path)}>
                  New file here...
                </ContextMenu.Item>
                <ContextMenu.Item class="sidebar-context-item" onSelect={() => props.ops.remove(p.entry.path, p.entry.name)}>
                  Delete folder
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </Show>
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
            <span class="sidebar-icon">{'📄'}</span>
            <span class="sidebar-item-name">{p.entry.name.replace(/\.md$/, '')}</span>
            <RowMenu items={[
              { label: 'Rename...', action: () => props.ops.rename(p.entry.path, p.entry.name) },
              { label: 'Delete', action: () => props.ops.remove(p.entry.path, p.entry.name) },
            ]} />
          </ContextMenu.Trigger>
          <Show when={!props.readOnly}>
            <ContextMenu.Portal>
              <ContextMenu.Content class="sidebar-context-menu">
                <ContextMenu.Item class="sidebar-context-item" onSelect={() => props.ops.rename(p.entry.path, p.entry.name)}>
                  Rename...
                </ContextMenu.Item>
                <ContextMenu.Item class="sidebar-context-item" onSelect={() => props.ops.remove(p.entry.path, p.entry.name)}>
                  Delete
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </Show>
        </ContextMenu.Root>
      </li>
    );
  };

  return (
    <div class="sidebar-tree">
      <Show when={props.ops.files()} fallback={<div class="sidebar-error">Loading...</div>}>
        <ul>
          <For each={props.ops.files()!}>{(entry) => FileTreeItem(entry)}</For>
        </ul>
      </Show>
    </div>
  );
};
