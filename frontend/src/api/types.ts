export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children: FileEntry[] | null;
}
