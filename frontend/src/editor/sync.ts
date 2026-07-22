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
import type { Vault } from '../api/types';

const MAX_RETRIES = 3;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const IDB_HEALTH_INTERVAL_MS = 120_000;

// Bump this whenever a release invalidates existing client-side CRDT state — e.g. after a server-side
// restore that rewrites a doc's Y.Doc history. A cached Y.Doc from a different history doubles content
// when it merges, so stale caches must be dropped, never synced. Each doc-open compares this against a
// per-doc localStorage marker and clears that doc's IndexedDB cache on mismatch.
// 1: initial epoch (2026-07: recovery from the paste-indent sync corruption bug).
// 2: 2026-07 vault-wide dedup — server sidecars rewritten, so stale client caches must be dropped.
const CRDT_CACHE_EPOCH = 2;
const EPOCH_MARKER_PREFIX = 'mdnotes:crdt-epoch:';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
/** Aggregate across all live sync sessions; null = no docs open. */
export type AggregateConnectionStatus = ConnectionStatus | null;
type StatusListener = (status: AggregateConnectionStatus) => void;
type ErrorListener = (message: string | null) => void;
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

// Connection status is tracked per session and aggregated worst-wins, so one pane's teardown or
// reconnect cycle can't masquerade as the state of the whole app (each provider only emits its own
// transitions, so a last-writer-wins global would stick on whatever the most recent event happened
// to be — e.g. "Offline" from a closed pane while the surviving pane is connected).
const sessionStatuses = new Map<number, ConnectionStatus>();
let nextSessionId = 0;
let aggregateStatus: AggregateConnectionStatus = null;

export function aggregateSessionStatuses(
  statuses: Iterable<ConnectionStatus>,
): AggregateConnectionStatus {
  let agg: AggregateConnectionStatus = null;
  for (const s of statuses) {
    if (s === 'disconnected') return 'disconnected';
    if (s === 'connecting' || agg === null) agg = s;
  }
  return agg;
}

function recomputeAggregateStatus(): void {
  const agg = aggregateSessionStatuses(sessionStatuses.values());
  if (agg === aggregateStatus) return;
  aggregateStatus = agg;
  for (const listener of statusListeners) {
    listener(agg);
  }
}

export function getConnectionStatus(): AggregateConnectionStatus {
  return aggregateStatus;
}

function notifyError(message: string | null): void {
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

export function getWsUrl(serverUrl: string): string {
  const url = new URL(serverUrl || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.origin;
}

export interface SyncSession {
  extension: Extension;
  undoManager: Y.UndoManager;
  /** The live doc, shared with the server; comments live in its 'comments' Y.Map. */
  ydoc: Y.Doc;
  /** The 'content' text the editor is bound to. */
  ytext: Y.Text;
  getText: () => string;
  /** Resolves after the first server sync; rejects on timeout or hard failure. */
  ready: Promise<void>;
  destroy: () => void;
}

// Returns true when the cache for idbKey is on the current epoch (clearing a stale one if needed).
// False means a stale DB exists but couldn't be deleted (another tab holds it open) — the caller must
// skip local persistence for the session so the stale state is never synced.
export async function ensureFreshIdbCache(idbKey: string): Promise<boolean> {
  const marker = EPOCH_MARKER_PREFIX + idbKey;
  if (localStorage.getItem(marker) === String(CRDT_CACHE_EPOCH)) return true;
  if (!(await tryDeleteIDBDatabase(idbKey))) return false;
  localStorage.setItem(marker, String(CRDT_CACHE_EPOCH));
  return true;
}

/** Awareness user state for collaboration cursors, with a color derived from the name. */
export function awarenessUser(name: string): { name: string; color: string; colorLight: string } {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  const hue = hash % 360;
  return {
    name,
    color: `hsl(${hue}, 65%, 45%)`,
    colorLight: `hsla(${hue}, 65%, 45%, 0.3)`,
  };
}

function buildSession(
  wsUrl: string,
  roomName: string,
  idbKey: string,
  wsParams?: Record<string, string>,
  userName?: string,
): SyncSession {
  let consecutiveFailures = 0;
  let destroyed = false;

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  const provider = new WebsocketProvider(wsUrl, roomName, ydoc, { params: wsParams ?? {} });
  // Label our cursor for other collaborators (y-codemirror shows "Anonymous" otherwise).
  if (userName) provider.awareness.setLocalStateField('user', awarenessUser(userName));
  const undoManager = new Y.UndoManager(ytext);

  const sessionId = nextSessionId++;
  const setSessionStatus = (status: ConnectionStatus) => {
    if (destroyed) return;
    sessionStatuses.set(sessionId, status);
    recomputeAggregateStatus();
  };
  // The provider starts connecting inside its constructor, before we can subscribe to 'status',
  // so seed the initial state rather than waiting for an event.
  setSessionStatus('connecting');

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

  // Local persistence attaches only after the cache is confirmed on the current epoch. A stale cache
  // that can't be cleared (another tab holds it open) fails the whole open — syncing it would double
  // the doc's content.
  let idbPersistence: IndexeddbPersistence | null = null;
  let idbHealthInterval: ReturnType<typeof setInterval> | null = null;
  const cacheReady = ensureFreshIdbCache(idbKey).then((fresh) => {
    if (destroyed) return false;
    if (!fresh) {
      rejectReady(new Error('This doc\'s local cache is outdated and another tab is holding it open — close other md-notes tabs and reopen'));
      return false;
    }
    const persistence = new IndexeddbPersistence(idbKey, ydoc);
    idbPersistence = persistence;
    persistence.whenSynced
      .then(() => {
        idbHealthInterval = setInterval(() => {
          try {
            const db = (persistence as any).db as IDBDatabase | undefined;
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
    return true;
  });

  // ready gates on BOTH the server handshake and the cache-epoch check, so a failed check can't be
  // masked by the handshake resolving first.
  provider.on('sync', (isSynced: boolean) => {
    if (isSynced) {
      cacheReady.then((ok) => {
        if (!ok) return;
        resolveReady();
        notifyLastSynced();
      });
    }
  });

  // Gate on `synced` (handshake done this connection), not just `wsconnected`: edits made while the
  // socket is open but the sync handshake is still pending haven't reached the server yet.
  ydoc.on('update', (_update: Uint8Array, origin: any) => {
    if (provider.synced) notifyLastSynced();
  });

  provider.on('status', (event: { status: string }) => {
    if (event.status === 'connected') {
      consecutiveFailures = 0;
      notifyError(null);
    }
    setSessionStatus(event.status as ConnectionStatus);
  });

  // Giving up is only valid while the initial handshake is pending (fail the open with a clear
  // error). After a doc has synced once, provider.disconnect() must never be called on failures:
  // it permanently stops y-websocket's backoff reconnect, leaving the UI stuck on "Connecting..."
  // while edits pile up locally until a page refresh. Post-handshake outages are left to the
  // provider's own retry loop, which reconnects as soon as the server is reachable again.
  const failHandshake = (message: string) => {
    provider.disconnect();
    setSessionStatus('disconnected');
    notifyError(message);
    rejectReady(new Error(message));
  };

  provider.on('connection-error', (event: Event) => {
    const target = (event as { target?: { url?: string } }).target;
    const url = target?.url ?? wsUrl;
    consecutiveFailures++;
    if (!settled && consecutiveFailures >= MAX_RETRIES) {
      failHandshake(`Could not connect to ${url} after ${MAX_RETRIES} attempts`);
    }
  });

  provider.on('connection-close', (event: CloseEvent | null) => {
    if (event && event.code !== 1000 && event.code !== 1005) {
      const reason = event.reason || `code ${event.code}`;
      consecutiveFailures++;
      if (!settled && consecutiveFailures >= MAX_RETRIES) {
        failHandshake(`WebSocket closed: ${reason} (${wsUrl})`);
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

  return {
    extension,
    undoManager,
    ydoc,
    ytext,
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
      idbPersistence?.destroy();
      ydoc.destroy();
      sessionStatuses.delete(sessionId);
      recomputeAggregateStatus();
    },
  };
}

// Keyed by vault.id, which is the vault name for owned vaults (matching pre-federation caches)
// and the connection id for connected ones.
function vaultIdbKey(vaultId: string, filePath: string): string {
  return `mdnotes:vault:${vaultId}:${filePath}`;
}

function shareIdbKey(uuid: string, docPath: string): string {
  return `mdnotes:share:${uuid}:${docPath}`;
}

/** Doc sync for a vault (owned or connected): WS <host>/api/docs/{vault}/crdt_websocket/{filepath} */
export function createSyncSession(
  vault: Vault,
  filePath: string,
  serverUrl: string,
  userName?: string,
): SyncSession {
  const wsUrl =
    getWsUrl(vault.owned ? serverUrl : vault.host) +
    `/api/docs/${encodeURIComponent(vault.vault)}/crdt_websocket`;
  const params = vault.secret ? { secret: vault.secret } : undefined;
  return buildSession(wsUrl, filePath, vaultIdbKey(vault.id, filePath), params, userName);
}

/** Public share sync: WS /api/share/{uuid}/crdt_websocket/{docPath} */
export function createShareSyncSession(
  uuid: string,
  docPath: string,
  serverUrl: string,
  userName?: string,
): SyncSession {
  const wsUrl = getWsUrl(serverUrl) + `/api/share/${encodeURIComponent(uuid)}/crdt_websocket`;
  return buildSession(wsUrl, docPath, shareIdbKey(uuid, docPath), undefined, userName);
}

/** Drop IDB stores for a path and (for dirs) everything cached under it (call after rename/delete). */
export async function clearVaultDocCacheUnder(vaultId: string, path: string): Promise<void> {
  await deleteIDBDatabase(vaultIdbKey(vaultId, path));
  const prefix = vaultIdbKey(vaultId, `${path}/`);
  const all = await listIDBDatabases();
  await Promise.all(all.filter((n) => n.startsWith(prefix)).map(deleteIDBDatabase));
}

/** Drop IDB stores for every cached doc in a vault (call after delete/disconnect). */
export async function clearVaultCache(vaultId: string): Promise<void> {
  const prefix = `mdnotes:vault:${vaultId}:`;
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

// Resolves false when the delete fails or is blocked by another tab holding the DB open.
function tryDeleteIDBDatabase(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(false);
  });
}

function deleteIDBDatabase(name: string): Promise<void> {
  return tryDeleteIDBDatabase(name).then(() => undefined);
}
