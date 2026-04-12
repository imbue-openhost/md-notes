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

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type StatusListener = (status: ConnectionStatus) => void;
const statusListeners: StatusListener[] = [];

export function onConnectionStatus(listener: StatusListener): () => void {
  statusListeners.push(listener);
  return () => {
    const idx = statusListeners.indexOf(listener);
    if (idx >= 0) statusListeners.splice(idx, 1);
  };
}

function notifyStatus(status: ConnectionStatus): void {
  for (const listener of statusListeners) {
    listener(status);
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
): { extension: Extension; getText: () => string } {
  destroySync();

  ydoc = new Y.Doc();
  ytext = ydoc.getText('content');

  // y-websocket appends roomname to the serverUrl, producing:
  // ws://<host>/ws/sync/<docPath>
  const wsUrl = getWsUrl(serverUrl) + '/ws/sync';
  provider = new WebsocketProvider(wsUrl, docPath, ydoc);

  // IndexedDB persistence for offline support
  idbPersistence = new IndexeddbPersistence(`mdnotes-${docPath}`, ydoc);

  provider.on('status', (event: { status: string }) => {
    notifyStatus(event.status as ConnectionStatus);
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
