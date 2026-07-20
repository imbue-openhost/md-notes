import { createEffect, createSignal, For, onCleanup, onMount, Show, type Component } from 'solid-js';
import { ContextMenu, DropdownMenu } from '@kobalte/core';
import type { FileEntry } from '../../api/types';
import type { EditState, FileOps } from './file-ops';
import { Icon } from './icons';
import { isSelfOrDescendant, parentDir, selfAndAncestorDirs, stripMdExtension } from './paths';

interface Props {
  ops: FileOps;
  currentPath: string | null;
  onSelect: (path: string) => void;
  /** Per-row "⋯" menus for file actions — iOS Safari has no long-press
   * path to the right-click context menus (which are always present). */
  rowMenus?: boolean;
}

/** Inline name editor for create/rename. Commits on Enter or blur, cancels on Escape. */
const NameInput: Component<{
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}> = (props) => {
  let ref!: HTMLInputElement;
  let done = false;
  const commit = () => { if (!done) { done = true; props.onCommit(ref.value); } };
  const cancel = () => { if (!done) { done = true; props.onCancel(); } };

  onMount(() => {
    // The context menu that triggered the edit releases focus asynchronously
    // as it closes, so keep re-asserting focus briefly until it sticks.
    const deadline = Date.now() + 400;
    const claim = () => {
      if (done) return;
      if (document.activeElement !== ref) {
        ref.focus();
        ref.select();
      }
      if (document.activeElement !== ref && Date.now() < deadline) setTimeout(claim, 30);
    };
    claim();
  });

  return (
    <input
      ref={ref}
      class="sidebar-name-input"
      value={props.initial}
      spellcheck={false}
      aria-label="Name"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') cancel();
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
};

const HOVER_EXPAND_DELAY_MS = 600;

export const FileTree: Component<Props> = (props) => {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const [dragged, setDragged] = createSignal<{ path: string; type: 'file' | 'dir' } | null>(null);
  // '' targets the vault root; null = no active drop target.
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);

  const isExpanded = (path: string) => expanded().has(path);
  const expand = (path: string) => setExpanded((prev) => new Set(prev).add(path));
  const toggle = (path: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });

  // Reveal the folder an inline edit lives in (e.g. "New file" on a collapsed folder).
  createEffect(() => {
    const edit = props.ops.editing();
    if (!edit) return;
    const dir = edit.mode === 'create' ? edit.parentDir : parentDir(edit.path);
    const dirs = selfAndAncestorDirs(dir);
    if (dirs.length) setExpanded((prev) => new Set([...prev, ...dirs]));
  });

  function canDropInto(targetDir: string): boolean {
    const d = dragged();
    if (!d) return false;
    if (parentDir(d.path) === targetDir) return false;
    return !isSelfOrDescendant(targetDir, d.path);
  }

  function endDrag() {
    setDragged(null);
    setDropTarget(null);
  }

  function dropInto(targetDir: string) {
    const d = dragged();
    endDrag();
    if (d && !isSelfOrDescendant(targetDir, d.path)) props.ops.move(d.path, targetDir);
  }

  function dragStartHandler(entry: FileEntry) {
    return (e: DragEvent) => {
      e.dataTransfer?.setData('text/plain', entry.path);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      setDragged({ path: entry.path, type: entry.type });
    };
  }

  const renamingThis = (entry: FileEntry): EditState | null => {
    const edit = props.ops.editing();
    return edit?.mode === 'rename' && edit.path === entry.path ? edit : null;
  };

  const creatingIn = (dir: string): (EditState & { mode: 'create' }) | null => {
    const edit = props.ops.editing();
    return edit?.mode === 'create' && edit.parentDir === dir ? edit : null;
  };

  /** Ghost row holding the name input for a new file/folder. */
  const CreateRow: Component<{ dir: string }> = (p) => (
    <Show when={creatingIn(p.dir)}>
      {(edit) => (
        <li>
          <div
            class="sidebar-item sidebar-item-editing"
            classList={{ 'sidebar-item-editing-dir': edit().type === 'dir' }}
          >
            <Show when={edit().type === 'dir'}>
              <span class="sidebar-arrow"><Icon name="chevron-right" size={14} /></span>
            </Show>
            <NameInput
              initial=""
              onCommit={(v) => props.ops.submitEdit(v)}
              onCancel={() => props.ops.cancelEdit()}
            />
          </div>
        </li>
      )}
    </Show>
  );

  function FileTreeItem(entry: FileEntry) {
    if (entry.type === 'dir') return <FolderItem entry={entry} />;
    return <FileItem entry={entry} />;
  }

  const RowMenu: Component<{ items: { label: string; action: () => void }[] }> = (p) => (
    <Show when={props.rowMenus}>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          class="sidebar-row-menu-btn"
          title="Actions"
          onClick={(e: MouseEvent) => e.stopPropagation()}
        >⋯</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            class="sidebar-context-menu"
            onCloseAutoFocus={(e: Event) => e.preventDefault()}
          >
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
    let hoverTimer: number | null = null;
    const clearHoverTimer = () => {
      if (hoverTimer != null) { clearTimeout(hoverTimer); hoverTimer = null; }
    };
    onCleanup(clearHoverTimer);

    const menuItems = [
      { label: 'New file', action: () => props.ops.startCreate('file', p.entry.path) },
      { label: 'New folder', action: () => props.ops.startCreate('dir', p.entry.path) },
      { label: 'Rename', action: () => props.ops.startRename(p.entry.path, 'dir') },
      { label: 'Delete', action: () => props.ops.remove(p.entry.path, p.entry.name, 'dir') },
    ];

    return (
      <li
        classList={{ open: isExpanded(p.entry.path) }}
        onDragOver={(e: DragEvent) => {
          e.stopPropagation();
          if (!canDropInto(p.entry.path)) return;
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          setDropTarget(p.entry.path);
          if (!isExpanded(p.entry.path) && hoverTimer == null) {
            hoverTimer = window.setTimeout(() => expand(p.entry.path), HOVER_EXPAND_DELAY_MS);
          }
        }}
        onDragLeave={(e: DragEvent) => {
          if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
          clearHoverTimer();
          setDropTarget((t) => (t === p.entry.path ? null : t));
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          clearHoverTimer();
          if (canDropInto(p.entry.path)) dropInto(p.entry.path);
          else endDrag();
        }}
      >
        <ContextMenu.Root modal={false}>
          <ContextMenu.Trigger
            as="div"
            class="sidebar-item"
            classList={{ 'drop-target': dropTarget() === p.entry.path }}
            data-path={p.entry.path}
            data-type="dir"
            draggable={!renamingThis(p.entry)}
            onDragStart={dragStartHandler(p.entry)}
            onDragEnd={endDrag}
            onClick={() => toggle(p.entry.path)}
          >
            <span class="sidebar-arrow"><Icon name="chevron-right" size={14} /></span>
            <Show
              when={renamingThis(p.entry)}
              fallback={<span class="sidebar-item-name">{p.entry.name}</span>}
            >
              <NameInput
                initial={p.entry.name}
                onCommit={(v) => props.ops.submitEdit(v)}
                onCancel={() => props.ops.cancelEdit()}
              />
            </Show>
            <RowMenu items={menuItems} />
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content
              class="sidebar-context-menu"
              onCloseAutoFocus={(e: Event) => e.preventDefault()}
            >
              <For each={menuItems}>
                {(item) => (
                  <ContextMenu.Item class="sidebar-context-item" onSelect={item.action}>
                    {item.label}
                  </ContextMenu.Item>
                )}
              </For>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        <Show when={isExpanded(p.entry.path)}>
          <ul class="sidebar-children">
            <CreateRow dir={p.entry.path} />
            <For each={p.entry.children ?? []}>{(child) => FileTreeItem(child)}</For>
          </ul>
        </Show>
      </li>
    );
  };

  const FileItem: Component<{ entry: FileEntry }> = (p) => {
    const menuItems = [
      { label: 'Rename', action: () => props.ops.startRename(p.entry.path, 'file') },
      { label: 'Delete', action: () => props.ops.remove(p.entry.path, p.entry.name, 'file') },
    ];

    return (
      <li>
        <ContextMenu.Root modal={false}>
          <ContextMenu.Trigger
            as="div"
            class="sidebar-item"
            classList={{ active: p.entry.path === props.currentPath }}
            data-path={p.entry.path}
            data-type="file"
            draggable={!renamingThis(p.entry)}
            onDragStart={dragStartHandler(p.entry)}
            onDragEnd={endDrag}
            onClick={() => props.onSelect(p.entry.path)}
          >
            <Show
              when={renamingThis(p.entry)}
              fallback={<span class="sidebar-item-name">{stripMdExtension(p.entry.name)}</span>}
            >
              <NameInput
                initial={stripMdExtension(p.entry.name)}
                onCommit={(v) => props.ops.submitEdit(v)}
                onCancel={() => props.ops.cancelEdit()}
              />
            </Show>
            <RowMenu items={menuItems} />
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Content
              class="sidebar-context-menu"
              onCloseAutoFocus={(e: Event) => e.preventDefault()}
            >
              <For each={menuItems}>
                {(item) => (
                  <ContextMenu.Item class="sidebar-context-item" onSelect={item.action}>
                    {item.label}
                  </ContextMenu.Item>
                )}
              </For>
            </ContextMenu.Content>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </li>
    );
  };

  return (
    <div
      class="sidebar-tree"
      classList={{ 'drop-target-root': dropTarget() === '' }}
      onDragOver={(e: DragEvent) => {
        if (!canDropInto('')) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        setDropTarget('');
      }}
      onDragLeave={(e: DragEvent) => {
        if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return;
        setDropTarget((t) => (t === '' ? null : t));
      }}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        if (canDropInto('')) dropInto('');
        else endDrag();
      }}
    >
      <Show when={props.ops.files()} fallback={<div class="sidebar-error">Loading...</div>}>
        <ul>
          <CreateRow dir="" />
          <For each={props.ops.files()!}>{(entry) => FileTreeItem(entry)}</For>
        </ul>
      </Show>
    </div>
  );
};
