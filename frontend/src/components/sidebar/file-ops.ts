import { createSignal, createResource, type Accessor, type Resource } from 'solid-js';
import type { FileEntry } from '../../api/types';
import { listFiles, createFile, deleteFile, renameFile } from '../../api/vault-ops';
import {
  baseName, parentDir, joinPath, ensureMdExtension, stripMdExtension,
  isSelfOrDescendant, remapPath, entryExists,
} from './paths';

export interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  resolve: (confirmed: boolean) => void;
}

/** Inline-edit state: a name input rendered in the tree, either for a new entry or over an existing one. */
export type EditState =
  | { mode: 'create'; type: 'file' | 'dir'; parentDir: string }
  | { mode: 'rename'; type: 'file' | 'dir'; path: string };

export interface FileOps {
  files: Resource<FileEntry[]>;
  confirm: Accessor<ConfirmRequest | null>;
  closeConfirm: (confirmed: boolean) => void;
  editing: Accessor<EditState | null>;
  startCreate: (type: 'file' | 'dir', parentDir?: string) => void;
  startRename: (path: string, type: 'file' | 'dir') => void;
  cancelEdit: () => void;
  submitEdit: (name: string) => Promise<void>;
  move: (path: string, targetDir: string) => Promise<void>;
  remove: (path: string, name: string, type: 'file' | 'dir') => Promise<void>;
}

/**
 * File list + create/rename/move/delete operations shared by the sidebar
 * variants. Create and rename go through inline editing (the `editing`
 * signal, rendered by FileTree); delete confirmation goes through a confirm
 * signal the caller renders (see OpsDialog).
 */
export function createFileOps(opts: {
  onSelect: (path: string) => void;
  currentPath: () => string | null;
  /** Called after a successful delete so the app can close affected editors. */
  onDeleted?: (path: string) => void;
}): FileOps {
  const [files, { refetch }] = createResource(listFiles);
  const [confirm, setConfirm] = createSignal<ConfirmRequest | null>(null);
  const [editing, setEditing] = createSignal<EditState | null>(null);

  function askConfirm(message: string, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) => setConfirm({ message, confirmLabel, resolve }));
  }

  /** If the open doc is oldPath or inside it, follow it to its new location. */
  function remapCurrent(oldPath: string, newPath: string) {
    const cur = opts.currentPath();
    if (cur && isSelfOrDescendant(cur, oldPath)) {
      opts.onSelect(remapPath(cur, oldPath, newPath));
    }
  }

  async function submitEdit(name: string): Promise<void> {
    const edit = editing();
    setEditing(null);
    if (!edit) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes('/')) return;
    const finalName = edit.type === 'file' ? ensureMdExtension(trimmed) : trimmed;

    if (edit.mode === 'create') {
      const path = joinPath(edit.parentDir, finalName);
      if (entryExists(files(), path)) {
        alert(`"${finalName}" already exists here.`);
        return;
      }
      try {
        await createFile(path, '', edit.type);
        refetch();
        if (edit.type === 'file') opts.onSelect(path);
      } catch (e) { alert(`Failed to create: ${e}`); }
    } else {
      const newPath = joinPath(parentDir(edit.path), finalName);
      if (newPath === edit.path) return;
      if (entryExists(files(), newPath)) {
        alert(`"${finalName}" already exists here.`);
        return;
      }
      try {
        await renameFile(edit.path, newPath);
        refetch();
        remapCurrent(edit.path, newPath);
      } catch (e) { alert(`Failed to rename: ${e}`); }
    }
  }

  return {
    files,
    confirm,
    closeConfirm: (confirmed) => {
      confirm()?.resolve(confirmed);
      setConfirm(null);
    },

    editing,
    startCreate: (type, dir = '') => setEditing({ mode: 'create', type, parentDir: dir }),
    startRename: (path, type) => setEditing({ mode: 'rename', type, path }),
    cancelEdit: () => setEditing(null),
    submitEdit,

    async move(path, targetDir) {
      if (parentDir(path) === targetDir) return;
      if (isSelfOrDescendant(targetDir, path)) return;
      const newPath = joinPath(targetDir, baseName(path));
      if (entryExists(files(), newPath)) {
        alert(`"${baseName(path)}" already exists in the target folder.`);
        return;
      }
      try {
        await renameFile(path, newPath);
        refetch();
        remapCurrent(path, newPath);
      } catch (e) { alert(`Failed to move: ${e}`); }
    },

    async remove(path, name, type) {
      const message = type === 'dir'
        ? `Delete folder "${name}" and all its contents?`
        : `Delete "${stripMdExtension(name)}"?`;
      if (!await askConfirm(message, 'Delete')) return;
      try {
        await deleteFile(path);
        refetch();
        opts.onDeleted?.(path);
      } catch (e) { alert(`Failed to delete: ${e}`); }
    },
  };
}
