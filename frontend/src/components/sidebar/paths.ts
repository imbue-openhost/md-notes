import type { FileEntry } from '../../api/types';

// Vault-relative paths with '/' separators; '' is the vault root.

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function ensureMdExtension(name: string): string {
  return name.endsWith('.md') ? name : `${name}.md`;
}

export function stripMdExtension(name: string): string {
  return name.replace(/\.md$/, '');
}

/** True if `path` is `ancestor` itself or lives anywhere under it. */
export function isSelfOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** New path for `path` after `ancestor` (the path itself or a dir containing it) moves to `newAncestorPath`. */
export function remapPath(path: string, ancestor: string, newAncestorPath: string): string {
  return newAncestorPath + path.slice(ancestor.length);
}

/** ['a', 'a/b'] for 'a/b'; [] for ''. Used to expand every folder on the way to a path. */
export function selfAndAncestorDirs(dir: string): string[] {
  if (!dir) return [];
  const parts = dir.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

export function entryExists(entries: FileEntry[] | undefined | null, path: string): boolean {
  for (const e of entries ?? []) {
    if (e.path === path) return true;
    if (e.type === 'dir' && path.startsWith(`${e.path}/`)) return entryExists(e.children, path);
  }
  return false;
}
