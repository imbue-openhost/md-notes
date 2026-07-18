import { createSignal, createResource, type Accessor, type Resource } from 'solid-js';
import type { FileEntry } from '../../api/types';
import { listFiles, createFile, deleteFile, renameFile } from '../../api/vault-ops';

export interface DialogRequest {
  label: string;
  defaultValue?: string;
  resolve: (v: string | null) => void;
}

export interface FileOps {
  files: Resource<FileEntry[]>;
  dialog: Accessor<DialogRequest | null>;
  closeDialog: (result: string | null) => void;
  newFile: () => Promise<void>;
  newFileInDir: (dirPath: string) => Promise<void>;
  rename: (path: string, name: string) => Promise<void>;
  remove: (path: string, name: string) => Promise<void>;
}

/**
 * File list + create/rename/delete operations shared by the sidebar
 * variants. Prompts go through a dialog signal the caller renders (see
 * OpsDialog).
 */
export function createFileOps(opts: {
  onSelect: (path: string) => void;
  currentPath: () => string | null;
}): FileOps {
  const [files, { refetch }] = createResource(listFiles);
  const [dialog, setDialog] = createSignal<DialogRequest | null>(null);

  function prompt(label: string, defaultValue = ''): Promise<string | null> {
    return new Promise((resolve) => setDialog({ label, defaultValue, resolve }));
  }

  return {
    files,
    dialog,
    closeDialog: (result) => {
      dialog()?.resolve(result);
      setDialog(null);
    },

    async newFile() {
      const name = await prompt('File name (e.g., note.md)');
      if (!name) return;
      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      try {
        await createFile(fileName);
        refetch();
        opts.onSelect(fileName);
      } catch (e) { alert(`Failed to create file: ${e}`); }
    },

    async newFileInDir(dirPath: string) {
      const name = await prompt('File name (e.g., note.md)');
      if (!name) return;
      const fileName = name.endsWith('.md') ? name : `${name}.md`;
      const fullPath = `${dirPath}/${fileName}`;
      try {
        await createFile(fullPath);
        refetch();
        opts.onSelect(fullPath);
      } catch (e) { alert(`Failed to create file: ${e}`); }
    },

    async rename(path: string, name: string) {
      const newName = await prompt('New name', name);
      if (!newName || newName === name) return;
      const parts = path.split('/');
      parts[parts.length - 1] = newName.endsWith('.md') ? newName : `${newName}.md`;
      const newPath = parts.join('/');
      try {
        await renameFile(path, newPath);
        refetch();
        if (opts.currentPath() === path) opts.onSelect(newPath);
      } catch (e) { alert(`Failed to rename: ${e}`); }
    },

    async remove(path: string, name: string) {
      const confirmed = await prompt(`Type "delete" to confirm deleting "${name}"`);
      if (confirmed !== 'delete') return;
      try {
        await deleteFile(path);
        refetch();
      } catch (e) { alert(`Failed to delete: ${e}`); }
    },
  };
}
