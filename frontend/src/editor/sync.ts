/**
 * Yjs sync — instance-based sync sessions for per-tab document sync.
 *
 * Each call to createSyncSession() / createShareSyncSession() returns an
 * independent session with its own Y.Doc, WebSocket provider, and IndexedDB
 * persistence. The server persists Y.Doc state to a sidecar across room
 * shutdowns, so reconnects sync incrementally against the same internal
 * clientIDs/clocks — no special client-side handling is needed for room
 * recreation.
 *
 * # Why doc opens require an online handshake
 *
 * IndexedDB persistence lets edits keep flowing after a mid-session backend
 * outage, and y-websocket's BroadcastChannel keeps multiple tabs on the same
 * origin in sync without round-tripping the server. But we intentionally do
 * NOT allow opening a doc from the IDB cache alone:
 *
 * - A cached doc may be arbitrarily stale — the user could have edited it
 *   from another device since this client last synced.
 * - Distinguishing "cached but empty" from "never opened" inside IDB is
 *   ambiguous without an explicit marker we'd have to maintain.
 * - Showing a stale or empty doc as if it were live is a worse failure mode
 *   than a clear "can't connect" error.
 *
 * So every open waits for a server `sync` event before rendering the editor.
 *
 * Once a session is past that initial handshake, IDB persistence is what
 * keeps the experience usable through brief outages: edits flow into the
 * local Y.Doc and IDB regardless of websocket state, and y-websocket's own
 * reconnect logic pushes them back to the server when it returns. The
 * handshake gate is only relevant on the *first* open of a doc this session.
 *
 * A future "background sync the whole vault on connect" would let us drop
 * the strict-online-open rule, but that's not built yet.
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { yCollab } from 'y-codemirror.next';
import { Facet, type Extension } from '@codemirror/state';

const MAX_RETRIES = 3;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const IDB_HEALTH_INTERVAL_MS = 120_000;

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
type StatusListener = (status: ConnectionStatus) => void;
type ErrorListener = (message: string) => void;
type LastSyncedListener = (ts: number) => void;
type IdbErrorListener = (message: string | null) => void;

const statusListeners: StatusListener[] = [];
const errorListeners: ErrorListener[] = [];
const lastSyncedListeners: LastSyncedListener[] = [];
const idbErrorListeners: IdbErrorListener[] = [];

let lastError: string | null = null;
let lastSyncedAt: number | null = null;
let lastSyncedDebounce: ReturnType<typeof setTimeout> | null = null;
let lastIdbError: string | null = null;

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

export function onLastSyncedAt(listener: LastSyncedListener): () => void {
  lastSyncedListeners.push(listener);
  return () => {
    const idx = lastSyncedListeners.indexOf(listener);
    if (idx >= 0) lastSyncedListeners.splice(idx, 1);
  };
}

export function onIdbError(listener: IdbErrorListener): () => void {
  idbErrorListeners.push(listener);
  return () => {
    const idx = idbErrorListeners.indexOf(listener);
    if (idx >= 0) idbErrorListeners.splice(idx, 1);
  };
}

export function getLastConnectionError(): string | null {
  return lastError;
}

export function getLastSyncedAt(): number | null {
  return lastSyncedAt;
}

export function getLastIdbError(): string | null {
  return lastIdbError;
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

function notifyLastSynced(): void {
  lastSyncedAt = Date.now();
  if (lastSyncedDebounce) return;
  lastSyncedDebounce = setTimeout(() => {
    lastSyncedDebounce = null;
    for (const listener of lastSyncedListeners) listener(lastSyncedAt!);
  }, 1000);
}

function notifyIdbError(message: string | null): void {
  if (message === lastIdbError) return;
  lastIdbError = message;
  for (const listener of idbErrorListeners) listener(message);
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
  /** Resolves after the first server sync; rejects on timeout or hard failure. */
  ready: Promise<void>;
  destroy: () => void;
}

function buildSession(wsUrl: string, roomName: string, idbKey: string): SyncSession {
  let consecutiveFailures = 0;

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  const idbPersistence = new IndexeddbPersistence(idbKey, ydoc);
  const provider = new WebsocketProvider(wsUrl, roomName, ydoc);
  const undoManager = new Y.UndoManager(ytext);

  let resolveReady!: () => void;
  let rejectReady!: (e: Error) => void;
  let settled = false;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = () => { if (settled) return; settled = true; res(); };
    rejectReady = (e) => { if (settled) return; settled = true; rej(e); };
  });
  const handshakeTimer = setTimeout(() => {
    rejectReady(new Error(`Sync handshake timed out after ${HANDSHAKE_TIMEOUT_MS}ms`));
  }, HANDSHAKE_TIMEOUT_MS);
  ready.finally(() => clearTimeout(handshakeTimer)).catch(() => {});

  provider.on('sync', (isSynced: boolean) => {
    if (isSynced) {
      resolveReady();
      notifyLastSynced();
    }
  });

  ydoc.on('update', (_update: Uint8Array, origin: any) => {
    if (provider.wsconnected) notifyLastSynced();
  });

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
      rejectReady(new Error(`Could not connect to ${url}`));
    }
  });

  provider.on('connection-close', (event: CloseEvent | null) => {
    if (event && event.code !== 1000 && event.code !== 1005) {
      const reason = event.reason || `code ${event.code}`;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_RETRIES) {
        provider.disconnect();
        notifyError(`WebSocket closed: ${reason} (${wsUrl})`);
        rejectReady(new Error(`WebSocket closed: ${reason}`));
      }
    }
  });

  let idbHealthInterval: ReturnType<typeof setInterval> | null = null;
  idbPersistence.whenSynced
    .then(() => {
      idbHealthInterval = setInterval(() => {
        try {
          const db = (idbPersistence as any).db as IDBDatabase | undefined;
          if (db && db.objectStoreNames.length > 0) {
            const tx = db.transaction(db.objectStoreNames[0], 'readonly');
            tx.abort();
          }
          if (lastIdbError) notifyIdbError(null);
        } catch {
          notifyIdbError('Local storage connection lost — recent edits may not be saved locally');
        }
      }, IDB_HEALTH_INTERVAL_MS);
    })
    .catch((err: Error) => {
      notifyIdbError(`Local storage failed to load: ${err.message}`);
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
    ready,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(handshakeTimer);
      if (idbHealthInterval) clearInterval(idbHealthInterval);
      rejectReady(new Error('Session destroyed'));
      provider.disconnect();
      provider.destroy();
      idbPersistence.destroy();
      ydoc.destroy();
    },
  };
}

function vaultIdbKey(vault: string, filePath: string): string {
  return `mdnotes:vault:${vault}:${filePath}`;
}

function shareIdbKey(uuid: string, docPath: string): string {
  return `mdnotes:share:${uuid}:${docPath}`;
}

/** Authenticated doc sync: WS /api/docs/{vault}/crdt_websocket/{filepath} */
export function createSyncSession(
  vaultName: string,
  filePath: string,
  serverUrl: string,
): SyncSession {
  const wsUrl = getWsUrl(serverUrl) + `/api/docs/${encodeURIComponent(vaultName)}/crdt_websocket`;
  return buildSession(wsUrl, filePath, vaultIdbKey(vaultName, filePath));
}

/** Public share sync: WS /api/share/{uuid}/crdt_websocket/{docPath} */
export function createShareSyncSession(
  uuid: string,
  docPath: string,
  serverUrl: string,
): SyncSession {
  const wsUrl = getWsUrl(serverUrl) + `/api/share/${encodeURIComponent(uuid)}/crdt_websocket`;
  return buildSession(wsUrl, docPath, shareIdbKey(uuid, docPath));
}

/** Drop the IDB store for a single vault doc (call after server-side delete). */
export async function clearVaultDocCache(vaultName: string, filePath: string): Promise<void> {
  await deleteIDBDatabase(vaultIdbKey(vaultName, filePath));
}

/** Drop IDB stores for every cached doc in a vault. */
export async function clearVaultCache(vaultName: string): Promise<void> {
  const prefix = `mdnotes:vault:${vaultName}:`;
  const all = await listIDBDatabases();
  await Promise.all(
    all.filter((n) => n.startsWith(prefix)).map(deleteIDBDatabase),
  );
}

async function listIDBDatabases(): Promise<string[]> {
  // indexedDB.databases() is Chromium + Safari; Firefox returns undefined.
  // Without it we can't enumerate, so vault-wide cleanup becomes a no-op
  // there — orphaned entries just sit until the user clears site data.
  const fn = (indexedDB as { databases?: () => Promise<{ name?: string }[]> }).databases;
  if (!fn) return [];
  try {
    const infos = await fn.call(indexedDB);
    return infos.map((i) => i.name).filter((n): n is string => !!n);
  } catch {
    return [];
  }
}

function deleteIDBDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
