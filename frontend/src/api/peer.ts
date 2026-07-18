/**
 * Direct client for a *remote* md-notes instance's federation peer API.
 *
 * Requests go straight from the browser to the sharing instance, authenticated by the share
 * secret. Failures here are remote-instance problems, so they intentionally don't touch the
 * local connection-state tracking in client.ts.
 */

import type { FileEntry, RemoteVaultRef } from './types';

export class PeerAuthError extends Error {
  constructor() {
    super('Share was revoked or is invalid');
  }
}

function peerUrl(remote: RemoteVaultRef, path: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ ...params, secret: remote.secret });
  return `${remote.source_url}${path}?${search}`;
}

async function peerFetch(
  remote: RemoteVaultRef,
  path: string,
  params: Record<string, string> = {},
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(peerUrl(remote, path, params), init);
  if (res.status === 401) throw new PeerAuthError();
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Remote instance ${res.status}: ${body}`);
  }
  return res;
}

/** Must match the server's FEDERATION_API_VERSION; instances must agree to connect. */
export const FEDERATION_API_VERSION = 1;

export interface PeerVaultInfo {
  vault_name: string;
  permission: 'read' | 'write';
  app: string;
  api_version: number;
}

/** Standalone validation used by the invite landing page, before any remote is stored. */
export async function fetchPeerVaultInfo(sourceUrl: string, secret: string): Promise<PeerVaultInfo> {
  const search = new URLSearchParams({ secret });
  const res = await fetch(`${sourceUrl}/api/federation/peer/vault?${search}`);
  if (res.status === 401) throw new PeerAuthError();
  if (!res.ok) throw new Error(`Remote instance ${res.status}`);
  const info: PeerVaultInfo = await res.json();
  if (info.app !== 'md-notes' || info.api_version !== FEDERATION_API_VERSION) {
    throw new Error(`Incompatible instance (app=${info.app}, api_version=${info.api_version})`);
  }
  return info;
}

export interface InviteLink {
  sourceUrl: string;
  vault: string;
  secret: string;
}

/** Parse a pasted invite link (…/federation/connect?vault=…&secret=…); null if it isn't one. */
export function parseInviteLink(link: string): InviteLink | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.pathname.replace(/\/$/, '') !== '/federation/connect') return null;
  const secret = url.searchParams.get('secret') ?? '';
  if (!secret) return null;
  return { sourceUrl: url.origin, vault: url.searchParams.get('vault') ?? '', secret };
}

export async function listFiles(remote: RemoteVaultRef): Promise<FileEntry[]> {
  const res = await peerFetch(remote, '/api/federation/peer/docs');
  return res.json();
}

export async function readFile(remote: RemoteVaultRef, path: string): Promise<string> {
  const res = await peerFetch(remote, '/api/federation/peer/docs/file', { path });
  return res.text();
}

export async function createFile(
  remote: RemoteVaultRef,
  path: string,
  content = '',
  type: 'file' | 'dir' = 'file',
): Promise<void> {
  await peerFetch(remote, '/api/federation/peer/docs/file', { path }, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, type }),
  });
}

export async function renameFile(remote: RemoteVaultRef, oldPath: string, newPath: string): Promise<void> {
  await peerFetch(remote, '/api/federation/peer/docs/file', { path: oldPath }, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPath }),
  });
}

export async function deleteFile(remote: RemoteVaultRef, path: string): Promise<void> {
  await peerFetch(remote, '/api/federation/peer/docs/file', { path }, { method: 'DELETE' });
}

/** Accept bare hosts (assumed https) or full http(s) origins; strip trailing slashes. */
export function normalizeSourceUrl(source: string): string {
  let url = source.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//.test(url)) url = `https://${url}`;
  return url;
}
