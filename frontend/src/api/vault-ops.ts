/**
 * Vault-aware file operations via the REST API.
 */

import type { FileEntry, VaultConfig } from './types';
import * as api from './client';
import { clearVaultDocCache } from '../editor/sync';

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
  await api.renameFile(requireVaultName(), oldPath, newPath);
}

export async function deleteFile(path: string): Promise<void> {
  const vault = requireVaultName();
  await api.deleteFile(vault, path);
  // Drop any cached CRDT state so a future file at this path doesn't open
  // pre-populated with the deleted doc's content.
  await clearVaultDocCache(vault, path);
}
