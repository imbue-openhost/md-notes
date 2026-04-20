/**
 * Vault-aware file operations.
 *
 * In Tauri (desktop app): always uses local filesystem via Tauri commands,
 * regardless of sync mode. The sync flag only controls whether Yjs
 * real-time sync is enabled when editing.
 *
 * In browser: uses the REST API (no local filesystem available).
 */

import type { FileEntry, VaultConfig } from './types';
import { isTauri } from '../config';
import * as api from './client';

let activeVault: VaultConfig | null = null;

export function setActiveVault(vault: VaultConfig): void {
  activeVault = vault;
}

export function getActiveVault(): VaultConfig | null {
  return activeVault;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

function requireVaultName(): string {
  if (!activeVault?.name) throw new Error('No active vault');
  return activeVault.name;
}

export async function listFiles(): Promise<FileEntry[]> {
  if (isTauri && activeVault) {
    return invoke<FileEntry[]>('list_local_files', { vaultPath: activeVault.path });
  }
  return api.listFiles(requireVaultName());
}

export async function readFile(path: string): Promise<string> {
  if (isTauri && activeVault) {
    return invoke<string>('read_local_file', { vaultPath: activeVault.path, path });
  }
  return api.readFile(requireVaultName(), path);
}

export async function createFile(path: string, content = '', type: 'file' | 'dir' = 'file'): Promise<void> {
  if (isTauri && activeVault) {
    await invoke('create_local_file', {
      vaultPath: activeVault.path,
      path,
      content,
      fileType: type,
    });
    return;
  }
  await api.createFile(requireVaultName(), path, content, type);
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  if (isTauri && activeVault) {
    await invoke('rename_local_file', {
      vaultPath: activeVault.path,
      oldPath,
      newPath,
    });
    return;
  }
  await api.renameFile(requireVaultName(), oldPath, newPath);
}

export async function deleteFile(path: string): Promise<void> {
  if (isTauri && activeVault) {
    await invoke('delete_local_file', { vaultPath: activeVault.path, path });
    return;
  }
  await api.deleteFile(requireVaultName(), path);
}
