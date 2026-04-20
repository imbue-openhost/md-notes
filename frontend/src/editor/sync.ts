/**
 * Yjs sync — manages Y.Doc, WebSocket provider, and CM6 binding.
 *
 * Exports an extension that binds the editor to a Yjs document
 * synced via WebSocket to the server.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { yCollab } from 'y-codemirror.next';
import type { Extension } from '@codemirror/state';

let ydoc: Y.Doc | null = null;
let provider: WebsocketProvider | null = null;
let idbPersistence: IndexeddbPersistence | null = null;
let ytext: Y.Text | null = null;
let consecutiveFailures = 0;
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

/**
 * Derive the WebSocket URL from the current API base URL.
 */
function getWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.origin;
}

/**
 * Initialise Yjs sync for a document.
 *
 * Returns a CM6 extension that binds the editor to the Y.Text.
 * The editor content is replaced by whatever the server provides.
 */
export function initSync(
  docPath: string,
  serverUrl: string,
  apiKey?: string,
  initialContent?: string,
): { extension: Extension; getText: () => string } {
  destroySync();

  ydoc = new Y.Doc();
  ytext = ydoc.getText('content');

  // IndexedDB persistence — loads cached Yjs state from previous sessions.
  // Must be created BEFORE WebsocketProvider so IDB state is loaded first.
  idbPersistence = new IndexeddbPersistence(`mdnotes-${docPath}`, ydoc);

  // After IDB loads, if Y.Text is still empty (first-time sync for this doc),
  // populate from local file content. This avoids the duplication problem:
  // - If IDB has cached state → Y.Text already has content → skip insert
  // - If server later sends matching state → same Yjs history → clean merge
  // - If this is truly first time → insert local content → server gets it via sync
  if (initialContent) {
    idbPersistence.once('synced', () => {
      if (ytext && ytext.length === 0) {
        ytext.insert(0, initialContent);
      }
    });
  }

  // y-websocket appends roomname to the serverUrl, producing:
  // ws://<host>/ws/sync/<docPath>
  const wsUrl = getWsUrl(serverUrl) + '/ws/sync';
  const params: Record<string, string> = {};
  if (apiKey) {
    params.token = apiKey;
  }
  provider = new WebsocketProvider(wsUrl, docPath, ydoc, { params });

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
    if (consecutiveFailures >= MAX_RETRIES && provider) {
      provider.disconnect();
      notifyError(`Could not connect to ${url} after ${MAX_RETRIES} attempts`);
    }
  });

  provider.on('connection-close', (event: CloseEvent | null) => {
    if (event && event.code !== 1000 && event.code !== 1005) {
      const reason = event.reason || `code ${event.code}`;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_RETRIES && provider) {
        provider.disconnect();
        notifyError(`WebSocket closed: ${reason} (${wsUrl})`);
      }
    }
  });

  const extension = yCollab(ytext, provider.awareness);

  return {
    extension,
    getText: () => ytext?.toString() ?? '',
  };
}

/**
 * Tear down the current sync session.
 */
export function destroySync(): void {
  consecutiveFailures = 0;
  if (provider) {
    provider.disconnect();
    provider.destroy();
    provider = null;
  }
  if (idbPersistence) {
    idbPersistence.destroy();
    idbPersistence = null;
  }
  if (ydoc) {
    ydoc.destroy();
    ydoc = null;
  }
  ytext = null;
}

/**
 * Check whether sync is currently active.
 */
export function isSyncActive(): boolean {
  return provider !== null && provider.wsconnected;
}
