/**
 * Bidirectional file sync between the local Tauri vault and the remote server.
 *
 * On vault open:
 *   - Files only on desktop → upload to server
 *   - Files only on server  → download to desktop
 *   - Files on both with different content → server wins
 */

import type { FileEntry, VaultConfig } from './types';
import * as api from './client';

export interface SyncProgress {
  phase: 'listing' | 'uploading' | 'downloading' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

function flattenTree(entries: FileEntry[]): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      paths.push(entry.path);
    }
    if (entry.children) {
      paths.push(...flattenTree(entry.children));
    }
  }
  return paths;
}

export async function syncVault(
  vault: VaultConfig,
  onProgress?: SyncProgressCallback,
): Promise<void> {
  onProgress?.({ phase: 'listing', current: 0, total: 0, message: 'Fetching file lists...' });

  let localPaths: string[];
  let remotePaths: string[];
  try {
    const [localTree, remoteTree] = await Promise.all([
      invoke<FileEntry[]>('list_local_files', { vaultPath: vault.path }),
      api.listFiles(vault.id),
    ]);
    localPaths = flattenTree(localTree);
    remotePaths = flattenTree(remoteTree);
  } catch (e) {
    onProgress?.({ phase: 'error', current: 0, total: 0, message: `Failed to list files: ${e}` });
    return;
  }

  const localSet = new Set(localPaths);
  const remoteSet = new Set(remotePaths);
  const localOnly = localPaths.filter((p) => !remoteSet.has(p));
  const remoteOnly = remotePaths.filter((p) => !localSet.has(p));
  const both = localPaths.filter((p) => remoteSet.has(p));

  // Compare content for files on both sides, cache remote content for changed files
  const toDownload: { path: string; content: string }[] = [];
  for (const path of both) {
    try {
      const [localContent, remoteContent] = await Promise.all([
        invoke<string>('read_local_file', { vaultPath: vault.path, path }),
        api.readFile(vault.id, path),
      ]);
      if (localContent !== remoteContent) {
        toDownload.push({ path, content: remoteContent });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  const uploadCount = localOnly.length;
  const downloadCount = remoteOnly.length + toDownload.length;
  const totalOps = uploadCount + downloadCount;

  if (totalOps === 0) {
    onProgress?.({ phase: 'done', current: 0, total: 0, message: 'Already in sync' });
    return;
  }

  let completed = 0;

  // Upload local-only files to server
  for (const path of localOnly) {
    onProgress?.({ phase: 'uploading', current: completed, total: totalOps, message: `Uploading ${path}` });
    try {
      const content = await invoke<string>('read_local_file', { vaultPath: vault.path, path });
      await api.createFile(vault.id, path, content);
    } catch {
      // Skip individual failures
    }
    completed++;
  }

  // Download server-only files to local
  for (const path of remoteOnly) {
    onProgress?.({ phase: 'downloading', current: completed, total: totalOps, message: `Downloading ${path}` });
    try {
      const content = await api.readFile(vault.id, path);
      await invoke('write_local_file', { vaultPath: vault.path, path, content });
    } catch {
      // Skip individual failures
    }
    completed++;
  }

  // Download changed files (server wins)
  for (const { path, content } of toDownload) {
    onProgress?.({ phase: 'downloading', current: completed, total: totalOps, message: `Updating ${path}` });
    try {
      await invoke('write_local_file', { vaultPath: vault.path, path, content });
    } catch {
      // Skip individual failures
    }
    completed++;
  }

  onProgress?.({
    phase: 'done',
    current: totalOps,
    total: totalOps,
    message: `Synced ${totalOps} file${totalOps === 1 ? '' : 's'}`,
  });
}
