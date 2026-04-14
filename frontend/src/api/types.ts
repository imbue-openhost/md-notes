export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: FileEntry[] | null;
}

export interface VaultConfig {
  id: string;
  name: string;
  path: string;
  sync: boolean;
}
