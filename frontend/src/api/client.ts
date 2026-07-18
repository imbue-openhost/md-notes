/**
 * REST API client for file operations.
 */

import type { FileEntry, RemoteVaultRef } from './types';
import {
  markConnected, markDisconnected, markUnauthorized, UnauthorizedError,
} from './connection';

let baseUrl = '';

/** Set the API base URL (e.g., "http://localhost:8080"). */
export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, '');
}

/** Auto-detect: if served by the Quart server, baseUrl is empty (same-origin). */
export function getApiBaseUrl(): string {
  return baseUrl;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, init);
  } catch (e) {
    markDisconnected();
    throw e;
  }
  if (res.status === 401 || res.status === 403) {
    markUnauthorized();
    throw new UnauthorizedError();
  }
  if (!res.ok) {
    // 5xx and other non-OK → backend reachable but failing. Treat as connected
    // for the purposes of the status indicator; the caller surfaces the error.
    if (res.status >= 500) markDisconnected();
    else markConnected();
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  markConnected();
  return res;
}

/** Lightweight authed probe for the connection heartbeat. */
export async function pingHealth(): Promise<void> {
  await apiFetch('/api/health');
}

function docsBase(vaultName: string): string {
  return `/api/docs/${encodeURIComponent(vaultName)}`;
}

function fileUrl(vaultName: string, path: string): string {
  return `${docsBase(vaultName)}/file?path=${encodeURIComponent(path)}`;
}

export async function listFiles(vaultName: string): Promise<FileEntry[]> {
  const res = await apiFetch(docsBase(vaultName));
  return res.json();
}

export async function readFile(vaultName: string, path: string): Promise<string> {
  const res = await apiFetch(fileUrl(vaultName, path));
  return res.text();
}

export async function createFile(
  vaultName: string,
  path: string,
  content = '',
  type: 'file' | 'dir' = 'file',
): Promise<void> {
  await apiFetch(fileUrl(vaultName, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type }),
  });
}

export async function renameFile(vaultName: string, oldPath: string, newPath: string): Promise<void> {
  await apiFetch(fileUrl(vaultName, oldPath), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPath }),
  });
}

export async function deleteFile(vaultName: string, path: string): Promise<void> {
  await apiFetch(fileUrl(vaultName, path), {
    method: 'DELETE',
  });
}

// ── Vaults ────────────────────────────────────────────────────────────────

export interface RemoteVault {
  name: string;
}

export async function listVaults(): Promise<RemoteVault[]> {
  const res = await apiFetch('/api/vaults');
  return res.json();
}

export async function createVault(name: string): Promise<RemoteVault> {
  const res = await apiFetch('/api/vaults', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function renameVault(oldName: string, newName: string): Promise<RemoteVault> {
  const res = await apiFetch(`/api/vaults/${encodeURIComponent(oldName)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });
  return res.json();
}

export async function deleteVault(name: string): Promise<void> {
  await apiFetch(`/api/vaults/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// ── Share links ───────────────────────────────────────────────────────────

export interface ShareLink {
  uuid: string;
  doc_path: string;
  permission: 'read' | 'write';
  created_at: string;
}

export async function createShareLink(
  docPath: string,
  permission: 'read' | 'write' = 'read',
): Promise<string> {
  const res = await apiFetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docPath, permission }),
  });
  const data = await res.json();
  return data.uuid;
}

export async function deleteShareLink(uuid: string): Promise<void> {
  await apiFetch(`/api/share/${encodeURIComponent(uuid)}`, {
    method: 'DELETE',
  });
}

export async function listShareLinks(docPath?: string): Promise<ShareLink[]> {
  const params = docPath ? `?docPath=${encodeURIComponent(docPath)}` : '';
  const res = await apiFetch(`/api/share${params}`);
  return res.json();
}

// ── Federation: outgoing vault shares ─────────────────────────────────────

export interface VaultShare {
  secret: string;
  vault_name: string;
  share_name: string;
  permission: 'read' | 'write';
  created_at: string;
  invite_url: string;
}

export async function createVaultShare(
  vaultName: string,
  name: string,
  permission: 'read' | 'write',
): Promise<VaultShare> {
  const res = await apiFetch('/api/federation/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vaultName, name, permission }),
  });
  return res.json();
}

export async function listVaultShares(vaultName?: string): Promise<VaultShare[]> {
  const params = vaultName ? `?vaultName=${encodeURIComponent(vaultName)}` : '';
  const res = await apiFetch(`/api/federation/shares${params}`);
  return res.json();
}

export async function revokeVaultShare(secret: string): Promise<void> {
  await apiFetch(`/api/federation/shares/${encodeURIComponent(secret)}`, { method: 'DELETE' });
}

// ── Federation: remote vaults stored on our server ────────────────────────

export async function listRemoteVaults(): Promise<RemoteVaultRef[]> {
  const res = await apiFetch('/api/federation/remotes');
  return res.json();
}

export async function addRemoteVault(
  sourceUrl: string,
  vaultName: string,
  secret: string,
  name = '',
): Promise<RemoteVaultRef> {
  const res = await apiFetch('/api/federation/remotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceUrl, vaultName, secret, name }),
  });
  return res.json();
}

export async function removeRemoteVault(id: string): Promise<void> {
  await apiFetch(`/api/federation/remotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── Settings ──────────────────────────────────────────────────────────────

export async function getServerVimrc(): Promise<string | null> {
  const res = await apiFetch('/api/settings/vimrc');
  const data = await res.json();
  return data.vimrc;
}

export async function saveServerVimrc(vimrc: string): Promise<void> {
  await apiFetch('/api/settings/vimrc', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vimrc }),
  });
}
