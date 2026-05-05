/**
 * Runtime environment detection and configuration.
 */

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export interface ShareInfo {
  uuid: string;
  doc_path: string;
  permission: 'read' | 'write';
}

/** True when running inside a Tauri native app. */
export const isTauri = typeof window !== 'undefined' &&
  !!(window.__TAURI_INTERNALS__ || window.__TAURI__);

/** True when running on the Vite dev server. */
export const isDevServer =
  typeof location !== 'undefined' &&
  (location.port === '5173' || location.port === '5174');

/** The server URL for API and WebSocket connections. */
export const serverUrl = isDevServer
  ? 'http://localhost:8080'
  : typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:8080';

/** UUID extracted from /share/<uuid> URLs, or null for the regular app. */
export function getShareUuid(): string | null {
  if (typeof window === 'undefined') return null;
  const match = window.location.pathname.match(/^\/share\/([^/]+)\/?$/);
  return match ? match[1] : null;
}

/** Fetch share-link metadata. The UUID in the URL is the capability — no auth required. */
export async function fetchShareInfo(uuid: string): Promise<ShareInfo> {
  const res = await fetch(`${serverUrl}/share/${encodeURIComponent(uuid)}/info`);
  if (!res.ok) throw new Error(`Share link not found (${res.status})`);
  return res.json();
}

/**
 * API key for authenticating with the server.
 * In the Tauri app this would come from the config file.
 * In the browser, same-origin requests go through the OpenHost
 * router which handles auth, so no key is needed.
 */
export function getApiKey(): string {
  return '';  // Browser doesn't need a key — OpenHost router handles auth
}
