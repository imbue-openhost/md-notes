/**
 * Yjs sync — instance-based sync sessions for per-tab document sync.
 *
 * Each call to createSyncSession() returns an independent session with
 * its own Y.Doc, WebSocket provider, and IDB persistence.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { yCollab } from 'y-codemirror.next';
import type { Extension } from '@codemirror/state';

const MAX_RETRIES = 3;

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type StatusListener = (status: ConnectionStatus) => void;
type ErrorListener = (message: string) => void;
const statusListeners: StatusListener[] = [];
const errorListeners: ErrorListener[] = [];
let lastError: string | null = null;

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

export function createSyncSession(
  docPath: string,
  serverUrl: string,
  initialContent?: string,
): SyncSession {
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');

  const idbPersistence = new IndexeddbPersistence(`mdnotes-${docPath}`, ydoc);

  if (initialContent) {
    idbPersistence.once('synced', () => {
      if (ytext.length === 0) {
        ytext.insert(0, initialContent);
      }
    });
  }

  const wsUrl = getWsUrl(serverUrl) + '/ws/sync';

  const provider = new WebsocketProvider(wsUrl, docPath, ydoc);
  let consecutiveFailures = 0;

  provider.on('status', (event: { status: string }) => {
    if (event.status === 'connected') consecutiveFailures = 0;
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

  const undoManager = new Y.UndoManager(ytext);
  const extension = yCollab(ytext, provider.awareness, { undoManager });

  return {
    extension,
    undoManager,
    getText: () => ytext.toString(),
    destroy: () => {
      provider.disconnect();
      provider.destroy();
      idbPersistence.destroy();
      ydoc.destroy();
    },
  };
}
