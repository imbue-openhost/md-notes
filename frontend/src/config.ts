/**
 * Runtime environment detection and configuration.
 */

interface RuntimeConfig {
  loginUrl: string | null;
}

declare global {
  interface Window {
    __CONFIG__?: RuntimeConfig;
  }
}

export interface ShareInfo {
  uuid: string;
  doc_path: string;
  permission: 'read' | 'write';
}

/** The server URL for API and WebSocket connections. */
export const serverUrl = typeof window !== 'undefined'
  ? window.location.origin
  : 'http://localhost:8080';

/** OpenHost login URL, injected at container start via runtime-config.js. */
export function getLoginUrl(): string | null {
  return typeof window !== 'undefined' ? window.__CONFIG__?.loginUrl ?? null : null;
}

/** UUID extracted from /share/<uuid> URLs, or null for the regular app. */
export function getShareUuid(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/share\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

/** Header anchor from the URL hash (e.g. #how-it-works), decoded, or null. */
export function getUrlHeaderAnchor(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Vault name extracted from /<vault-name> URLs, or null if at root. */
export function getVaultNameFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const seg = window.location.pathname.replace(/^\//, '').replace(/\/.*$/, '');
  if (!seg) return null;
  return decodeURIComponent(seg);
}

/** Fetch share-link metadata. The UUID in the URL is the capability — no auth required. */
export async function fetchShareInfo(uuid: string): Promise<ShareInfo> {
  const res = await fetch(`${serverUrl}/api/share/${encodeURIComponent(uuid)}`);
  if (!res.ok) throw new Error(`Share link not found (${res.status})`);
  return res.json();
}

