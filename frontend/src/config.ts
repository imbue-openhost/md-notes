/**
 * Runtime environment detection and configuration.
 */

export interface ShareInfo {
  uuid: string;
  doc_path: string;
  permission: 'read' | 'write';
}

/** The server URL for API and WebSocket connections. */
export const serverUrl = typeof window !== 'undefined'
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
  const res = await fetch(`${serverUrl}/api/share/${encodeURIComponent(uuid)}`);
  if (!res.ok) throw new Error(`Share link not found (${res.status})`);
  return res.json();
}

