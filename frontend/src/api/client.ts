/**
 * REST API client for file operations.
 */

import type { FileEntry } from './types';

let baseUrl = '';
let apiKey = '';

/** Set the API base URL (e.g., "http://localhost:8080"). */
export function setApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, '');
}

/** Set the API key for authenticated requests. */
export function setApiKey(key: string): void {
  apiKey = key;
}

/** Auto-detect: if served by the Quart server, baseUrl is empty (same-origin). */
export function getApiBaseUrl(): string {
  return baseUrl;
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (apiKey) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }
  return res;
}

function filesBase(vaultName: string): string {
  return `/api/vaults/${encodeURIComponent(vaultName)}/files`;
}

export async function listFiles(vaultName: string): Promise<FileEntry[]> {
  const res = await apiFetch(filesBase(vaultName));
  return res.json();
}

export async function readFile(vaultName: string, path: string): Promise<string> {
  const res = await apiFetch(`${filesBase(vaultName)}/${encodeURIComponent(path)}`);
  return res.text();
}

export async function createFile(
  vaultName: string,
  path: string,
  content = '',
  type: 'file' | 'dir' = 'file',
): Promise<void> {
  await apiFetch(`${filesBase(vaultName)}/${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type }),
  });
}

export async function renameFile(vaultName: string, oldPath: string, newPath: string): Promise<void> {
  await apiFetch(`${filesBase(vaultName)}/${encodeURIComponent(oldPath)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPath }),
  });
}

export async function deleteFile(vaultName: string, path: string): Promise<void> {
  await apiFetch(`${filesBase(vaultName)}/${encodeURIComponent(path)}`, {
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

export async function getServerApiKey(): Promise<string> {
  const res = await apiFetch('/api/key');
  const data = await res.json();
  return data.api_key;
}

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
