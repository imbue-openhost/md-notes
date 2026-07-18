/**
 * Interactive search session over a WebSocket (one per open search palette).
 *
 * Every keystroke is sent immediately — no client debouncing. The server
 * coalesces: each query message cancels the scan for the previous one, so
 * only the latest query completes and replies. Superseded queries get no
 * response, which is why results are matched back by id.
 */

import type { RemoteVaultRef, SearchHit } from './types';
import { getWsUrl } from '../editor/sync';

export interface SearchSession {
  /** Send a query; the result arrives via onResults with the same id (or never, if superseded). */
  search: (id: number, q: string, normalize: boolean) => void;
  close: () => void;
}

export function createSearchSession(
  vaultName: string,
  serverUrl: string,
  onResults: (id: number, hits: SearchHit[]) => void,
  onError: () => void,
  remote?: RemoteVaultRef,
): SearchSession {
  const url = remote
    ? `${getWsUrl(remote.source_url)}/api/federation/peer/search_websocket?secret=${encodeURIComponent(remote.secret)}`
    : `${getWsUrl(serverUrl)}/api/docs/${encodeURIComponent(vaultName)}/search_websocket`;
  let socket: WebSocket | null = null;
  let pending: string | null = null; // latest message queued while the socket connects
  let closed = false;

  function ensureSocket(): WebSocket {
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      return socket;
    }
    const ws = new WebSocket(url);
    ws.onopen = () => {
      if (pending) {
        ws.send(pending);
        pending = null;
      }
    };
    ws.onmessage = (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      const m = msg as { id?: unknown; hits?: unknown };
      if (typeof m.id === 'number' && Array.isArray(m.hits)) {
        onResults(m.id, m.hits as SearchHit[]);
      }
    };
    ws.onerror = () => {
      if (!closed) onError();
    };
    socket = ws;
    return ws;
  }

  return {
    search(id, q, normalize) {
      if (closed) return;
      const message = JSON.stringify({ id, q, normalize, limit: 50 });
      const ws = ensureSocket(); // lazily reconnects if the socket dropped
      if (ws.readyState === WebSocket.OPEN) ws.send(message);
      else pending = message;
    },
    close() {
      closed = true;
      pending = null;
      socket?.close();
      socket = null;
    },
  };
}
