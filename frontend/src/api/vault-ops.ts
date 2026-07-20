/**
 * Vault-aware file operations via the REST API.
 */

import type { FileEntry, VaultConfig } from './types';
import * as api from './client';
import { clearVaultDocCacheUnder } from '../editor/sync';

let activeVault: VaultConfig | null = null;

export function setActiveVault(vault: VaultConfig): void {
  activeVault = vault;
}

export function getActiveVault(): VaultConfig | null {
  return activeVault;
}

function requireVaultName(): string {
  if (!activeVault?.name) throw new Error('No active vault');
  return activeVault.name;
}

export async function listFiles(): Promise<FileEntry[]> {
  return api.listFiles(requireVaultName());
}

export async function readFile(path: string): Promise<string> {
  return api.readFile(requireVaultName(), path);
}

export async function createFile(path: string, content = '', type: 'file' | 'dir' = 'file'): Promise<void> {
  await api.createFile(requireVaultName(), path, content, type);
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const vault = requireVaultName();
  await api.renameFile(vault, oldPath, newPath);
  // Drop cached CRDT state under the old path so a future file created there
  // doesn't open pre-populated with the moved doc's content.
  await clearVaultDocCacheUnder(vault, oldPath);
}

export async function deleteFile(path: string): Promise<void> {
  const vault = requireVaultName();
  await api.deleteFile(vault, path);
  // Drop any cached CRDT state (including under a deleted folder) so a future
  // file at these paths doesn't open pre-populated with deleted content.
  await clearVaultDocCacheUnder(vault, path);
}
