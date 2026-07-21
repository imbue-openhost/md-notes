/**
 * Vault-share invites: parsing pasted invite links and validating them against the sharing
 * instance — straight from the browser; our own server only ever stores the connection record.
 */

import type { Permission } from './types';

/** Must match the server's FEDERATION_API_VERSION; instances must agree to connect. */
export const FEDERATION_API_VERSION = 1;

export class InviteRejectedError extends Error {
  constructor() {
    super('Share was revoked or is invalid');
  }
}

export interface ShareInfo {
  app: string;
  api_version: number;
  vault: string;
  permission: Permission;
}

/** Validate a share against its host and return its metadata (app/version handshake included). */
export async function fetchShareInfo(host: string, secret: string): Promise<ShareInfo> {
  const search = new URLSearchParams({ secret });
  const res = await fetch(`${host}/api/federation/share-info?${search}`);
  if (res.status === 401) throw new InviteRejectedError();
  if (!res.ok) throw new Error(`Remote instance ${res.status}`);
  const info: ShareInfo = await res.json();
  if (info.app !== 'md-notes' || info.api_version !== FEDERATION_API_VERSION) {
    throw new Error(`Incompatible instance (app=${info.app}, api_version=${info.api_version})`);
  }
  return info;
}

export interface InviteLink {
  host: string;
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
  return { host: url.origin, vault: url.searchParams.get('vault') ?? '', secret };
}
