/**
 * REST API client for file operations.
 */

import type { FileEntry, Permission, Vault } from './types';
import type { CommentsApi } from '../editor/comments/types';
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

// ── Vault-scoped data routes ──────────────────────────────────────────────
// One code path for owned and connected vaults: requests go to the vault's host with the share
// secret attached when present. Only requests to our own server feed the connection-state
// indicator — a foreign instance being down is not "the backend is down".

/** Base URL for a vault's docs API on its host ('' = same-origin for owned vaults). */
export function vaultApiBase(vault: Vault): string {
  return `${vault.owned ? baseUrl : vault.host}/api/docs/${encodeURIComponent(vault.vault)}`;
}

/** Append the vault's secret (if any) to a query string. */
export function withSecret(vault: Vault, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params);
  if (vault.secret) search.set('secret', vault.secret);
  const q = search.toString();
  return q ? `?${q}` : '';
}

async function vaultFetch(vault: Vault, url: string, init?: RequestInit): Promise<Response> {
  if (vault.owned) return apiFetch(url, init);
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${new URL(vault.host).host} ${res.status}: ${body}`);
  }
  return res;
}

function fileUrl(vault: Vault, path: string): string {
  return `${vaultApiBase(vault)}/file${withSecret(vault, { path })}`;
}

export async function listFiles(vault: Vault): Promise<FileEntry[]> {
  const res = await vaultFetch(vault, `${vaultApiBase(vault)}${withSecret(vault)}`);
  return res.json();
}

export async function readFile(vault: Vault, path: string): Promise<string> {
  const res = await vaultFetch(vault, fileUrl(vault, path));
  return res.text();
}

export async function createFile(
  vault: Vault,
  path: string,
  content = '',
  type: 'file' | 'dir' = 'file',
): Promise<void> {
  await vaultFetch(vault, fileUrl(vault, path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type }),
  });
}

export async function renameFile(vault: Vault, oldPath: string, newPath: string): Promise<void> {
  await vaultFetch(vault, fileUrl(vault, oldPath), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPath }),
  });
}

export async function deleteFile(vault: Vault, path: string): Promise<void> {
  await vaultFetch(vault, fileUrl(vault, path), {
    method: 'DELETE',
  });
}

// ── Vaults ────────────────────────────────────────────────────────────────

/** Owned and connected vaults, unified. */
export async function listVaults(): Promise<Vault[]> {
  const res = await apiFetch('/api/vaults');
  return res.json();
}

export async function createVault(name: string): Promise<Vault> {
  const res = await apiFetch('/api/vaults', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function renameVault(oldName: string, newName: string): Promise<Vault> {
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

/** Store a connection to a vault shared from another instance. */
export async function connectVault(
  host: string,
  vault: string,
  secret: string,
  permission: Permission,
  name = '',
): Promise<Vault> {
  const res = await apiFetch('/api/vaults/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, vault, secret, permission, name }),
  });
  return res.json();
}

export async function disconnectVault(connectionId: string): Promise<void> {
  await apiFetch(`/api/vaults/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
}

// ── Share links ───────────────────────────────────────────────────────────

export type SharePermission = 'read' | 'comment' | 'write';

export interface ShareLink {
  uuid: string;
  doc_path: string;
  permission: SharePermission;
  created_at: string;
}

export async function createShareLink(
  docPath: string,
  permission: SharePermission = 'read',
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
  permission: Permission;
  created_at: string;
  invite_url: string;
}

export async function createVaultShare(
  vaultName: string,
  name: string,
  permission: Permission,
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

// ── Comments ──────────────────────────────────────────────────────────────

// Comment routes get a bare fetch, not apiFetch: a 403 here is a domain-level permission result
// ("not your comment", "link doesn't allow commenting"), and must not flip the app's connection
// state to "unauthorized".
async function commentFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, init);
  if (!res.ok) {
    const body = await res.text();
    let message = body || `HTTP ${res.status}`;
    try {
      const data = JSON.parse(body);
      message = data.error || data.detail || message;
    } catch {}
    throw new Error(message);
  }
  return res;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function commentsApiAt(base: string, query: (extra?: string) => string): CommentsApi {
  return {
    async create(body) {
      const res = await commentFetch(`${base}${query()}`, jsonInit('POST', body));
      return (await res.json()).id;
    },
    async update(commentId, body) {
      await commentFetch(`${base}/${encodeURIComponent(commentId)}${query()}`, jsonInit('PATCH', body));
    },
    async remove(commentId, userId) {
      await commentFetch(
        `${base}/${encodeURIComponent(commentId)}${query(`userId=${encodeURIComponent(userId)}`)}`,
        { method: 'DELETE' },
      );
    },
  };
}

export function vaultCommentsApi(vault: Vault, filePath: string): CommentsApi {
  const secretParam = vault.secret ? `&secret=${encodeURIComponent(vault.secret)}` : '';
  return commentsApiAt(
    `${vaultApiBase(vault)}/comments`,
    (extra?: string) => `?path=${encodeURIComponent(filePath)}${secretParam}${extra ? `&${extra}` : ''}`,
  );
}

export function shareCommentsApi(uuid: string): CommentsApi {
  return commentsApiAt(
    `/api/share/${encodeURIComponent(uuid)}/comments`,
    (extra?: string) => (extra ? `?${extra}` : ''),
  );

}

// ── Settings ──────────────────────────────────────────────────────────────

/** Owner display name (from the OpenHost env), used to label the owner's comments. */
export async function getOwnerInfo(): Promise<{ displayName: string }> {
  const res = await apiFetch('/api/settings/me');
  return res.json();
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
