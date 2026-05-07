/**
 * Yjs sync — instance-based sync sessions for per-tab document sync.
 *
 * Each call to createSyncSession() / createShareSyncSession() returns an
 * independent session with its own Y.Doc and WebSocket provider. The server
 * persists Y.Doc state to a sidecar across room shutdowns, so reconnects sync
 * incrementally against the same internal clientIDs/clocks — no special
 * client-side handling is needed for room recreation.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import { Facet, type Extension } from '@codemirror/state';

const MAX_RETRIES = 3;

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type StatusListener = (status: ConnectionStatus) => void;
type ErrorListener = (message: string) => void;
const statusListeners: StatusListener[] = [];
const errorListeners: ErrorListener[] = [];
let lastError: string | null = null;

interface UndoRedoProvider {
  undo(): boolean;
  redo(): boolean;
}

export const undoRedoFacet = Facet.define<UndoRedoProvider, UndoRedoProvider | null>({
  combine: (inputs) => inputs[0] ?? null,
});

export function onConnectionStatus(listener: StatusListener): () => void {
  statusListeners.push(listener);
  return () => {
    const idx = statusListeners.indexOf(listener);
    if (idx >= 0) statusListeners.splice(idx, 1);
  };
}

export function onConnectionError(listener: ErrorListener): () => void {
  errorListeners.push(listener);
  return () => {
    const idx = errorListeners.indexOf(listener);
    if (idx >= 0) errorListeners.splice(idx, 1);
  };
}

export function getLastConnectionError(): string | null {
  return lastError;
}

function notifyStatus(status: ConnectionStatus): void {
  for (const listener of statusListeners) {
    listener(status);
  }
}

function notifyError(message: string): void {
  lastError = message;
  for (const listener of errorListeners) {
    listener(message);
  }
}

function getWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.origin;
}

export interface SyncSession {
  extension: Extension;
  undoManager: Y.UndoManager;
  getText: () => string;
  destroy: () => void;
}

function buildSession(wsUrl: string, roomName: string): SyncSession {
  let consecutiveFailures = 0;

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  const provider = new WebsocketProvider(wsUrl, roomName, ydoc);
  const undoManager = new Y.UndoManager(ytext);

  provider.on('status', (event: { status: string }) => {
    if (event.status === 'connected') {
      consecutiveFailures = 0;
    }
    notifyStatus(event.status as ConnectionStatus);
  });

  provider.on('connection-error', (event: Event) => {
    const target = (event as { target?: { url?: string } }).target;
    const url = target?.url ?? wsUrl;
    consecutiveFailures++;
    if (consecutiveFailures >= MAX_RETRIES) {
      provider.disconnect();
      notifyError(`Could not connect to ${url} after ${MAX_RETRIES} attempts`);
    }
  });

  provider.on('connection-close', (event: CloseEvent | null) => {
    if (event && event.code !== 1000 && event.code !== 1005) {
      const reason = event.reason || `code ${event.code}`;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_RETRIES) {
        provider.disconnect();
        notifyError(`WebSocket closed: ${reason} (${wsUrl})`);
      }
    }
  });

  const extension: Extension = [
    yCollab(ytext, provider.awareness, { undoManager }),
    undoRedoFacet.of({
      undo: () => undoManager.undo() != null,
      redo: () => undoManager.redo() != null,
    }),
  ];

  let destroyed = false;
  return {
    extension,
    undoManager,
    getText: () => ytext.toString(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      provider.disconnect();
      provider.destroy();
      ydoc.destroy();
    },
  };
}

/** Authenticated doc sync: WS /api/docs/{vault}/crdt_websocket/{filepath} */
export function createSyncSession(
  vaultName: string,
  filePath: string,
  serverUrl: string,
): SyncSession {
  const wsUrl = getWsUrl(serverUrl) + `/api/docs/${encodeURIComponent(vaultName)}/crdt_websocket`;
  return buildSession(wsUrl, filePath);
}

/** Public share sync: WS /api/share/{uuid}/crdt_websocket/{docPath} */
export function createShareSyncSession(
  uuid: string,
  docPath: string,
  serverUrl: string,
): SyncSession {
  const wsUrl = getWsUrl(serverUrl) + `/api/share/${encodeURIComponent(uuid)}/crdt_websocket`;
  return buildSession(wsUrl, docPath);
}
