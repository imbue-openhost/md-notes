/**
 * File operations on the active vault. Owned and connected vaults share one code path — the
 * client in client.ts routes each request to the vault's host with its secret when present.
 */

import type { FileEntry, Vault } from './types';
import * as api from './client';
import { clearVaultDocCacheUnder } from '../editor/sync';

let activeVault: Vault | null = null;

export function setActiveVault(vault: Vault): void {
  activeVault = vault;
}

export function getActiveVault(): Vault | null {
  return activeVault;
}

function requireVault(): Vault {
  if (!activeVault) throw new Error('No active vault');
  return activeVault;
}

/** True when the active vault cannot have its files edited (read or comment tier). */
export function isActiveVaultReadOnly(): boolean {
  return activeVault !== null && activeVault.permission !== 'write';
}

export async function listFiles(): Promise<FileEntry[]> {
  return api.listFiles(requireVault());
}

export async function readFile(path: string): Promise<string> {
  return api.readFile(requireVault(), path);
}

export async function createFile(path: string, content = '', type: 'file' | 'dir' = 'file'): Promise<void> {
  await api.createFile(requireVault(), path, content, type);
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const vault = requireVault();
  await api.renameFile(vault, oldPath, newPath);
  // Drop cached CRDT state under the old path so a future file created there
  // doesn't open pre-populated with the moved doc's content.
  await clearVaultDocCacheUnder(vault.id, oldPath);
}

export async function deleteFile(path: string): Promise<void> {
  const vault = requireVault();
  await api.deleteFile(vault, path);
  // Drop any cached CRDT state (including under a deleted folder) so a future
  // file at these paths doesn't open pre-populated with deleted content.
  await clearVaultDocCacheUnder(vault.id, path);
}
