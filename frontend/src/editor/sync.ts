/**
 * Yjs sync — instance-based sync sessions for per-tab document sync.
 *
 * Each call to createSyncSession() / createShareSyncSession() returns an
 * independent session with its own Y.Doc and WebSocket provider.
 * The server is authoritative — if the server's room was recreated (detected
 * via a changed room_epoch in the Y.Doc's meta map), the client creates a
 * fresh Y.Doc so the server's state is pulled cleanly with no stale local
 * state to merge (which would cause content duplication).
 */

import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { yCollab } from 'y-codemirror.next';
import { Compartment, Facet, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

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
  setView: (view: EditorView) => void;
}

function readEpoch(ydoc: Y.Doc): string | null {
  try {
    const meta = ydoc.getMap('meta');
    const epoch = meta.get('room_epoch');
    return typeof epoch === 'string' ? epoch : null;
  } catch {
    return null;
  }
}

/**
 * Build a sync session that survives server-side room recreation.
 *
 * The server stamps each room's Y.Doc with a random `room_epoch` in its
 * `meta` map. After every sync handshake the client checks this epoch:
 *
 *  - First sync: record the epoch.
 *  - Subsequent syncs with same epoch: normal reconnect, nothing to do.
 *  - Epoch changed: the server lost the old room and seeded a fresh Y.Doc
 *    from disk. Merging would duplicate content, so we throw away the local
 *    Y.Doc/provider and create new ones, swapping the CM6 extensions via
 *    compartment reconfiguration.
 *
 * A generation counter prevents stale event handlers from firing after a
 * rebuild (each buildInner() increments; handlers bail if theirs is outdated).
 */
function buildSession(wsUrl: string, roomName: string): SyncSession {
  const syncCompartment = new Compartment();
  const undoRedoCompartment = new Compartment();

  let view: EditorView | null = null;
  let destroyed = false;
  let knownEpoch: string | null = null;
  let generation = 0;

  let currentDoc: Y.Doc | null = null;
  let currentProvider: WebsocketProvider | null = null;
  let currentUndoManager: Y.UndoManager | null = null;

  function destroyCurrent(): void {
    if (currentProvider) {
      currentProvider.disconnect();
      currentProvider.destroy();
    }
    if (currentDoc) {
      currentDoc.destroy();
    }
    currentProvider = null;
    currentDoc = null;
    currentUndoManager = null;
  }

  function buildInner(): { syncExt: Extension; undoRedoExt: Extension } {
    const myGeneration = ++generation;
    let consecutiveFailures = 0;

    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('content');
    const provider = new WebsocketProvider(wsUrl, roomName, ydoc);
    const undoManager = new Y.UndoManager(ytext);

    currentDoc = ydoc;
    currentProvider = provider;
    currentUndoManager = undoManager;

    provider.on('status', (event: { status: string }) => {
      if (myGeneration !== generation) return;
      if (event.status === 'connected') {
        consecutiveFailures = 0;
      }
      notifyStatus(event.status as ConnectionStatus);
    });

    provider.on('sync', () => {
      if (myGeneration !== generation || destroyed) return;
      const epoch = readEpoch(ydoc);
      if (knownEpoch === null) {
        knownEpoch = epoch;
      } else if (epoch !== null && epoch !== knownEpoch) {
        knownEpoch = epoch;
        if (view) rebuild();
      }
    });

    provider.on('connection-error', (event: Event) => {
      if (myGeneration !== generation) return;
      const target = (event as { target?: { url?: string } }).target;
      const url = target?.url ?? wsUrl;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_RETRIES) {
        provider.disconnect();
        notifyError(`Could not connect to ${url} after ${MAX_RETRIES} attempts`);
      }
    });

    provider.on('connection-close', (event: CloseEvent | null) => {
      if (myGeneration !== generation) return;
      if (event && event.code !== 1000 && event.code !== 1005) {
        const reason = event.reason || `code ${event.code}`;
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_RETRIES) {
          provider.disconnect();
          notifyError(`WebSocket closed: ${reason} (${wsUrl})`);
        }
      }
    });

    const syncExt = yCollab(ytext, provider.awareness, { undoManager });
    const undoRedoExt = undoRedoFacet.of({
      undo: () => undoManager.undo() != null,
      redo: () => undoManager.redo() != null,
    });

    return { syncExt, undoRedoExt };
  }

  function rebuild(): void {
    const oldProvider = currentProvider;
    const oldDoc = currentDoc;

    const { syncExt, undoRedoExt } = buildInner();

    if (oldProvider) { oldProvider.disconnect(); oldProvider.destroy(); }
    if (oldDoc) { oldDoc.destroy(); }

    view!.dispatch({
      effects: [
        syncCompartment.reconfigure(syncExt),
        undoRedoCompartment.reconfigure(undoRedoExt),
      ],
    });
  }

  const { syncExt, undoRedoExt } = buildInner();

  const extension: Extension = [
    syncCompartment.of(syncExt),
    undoRedoCompartment.of(undoRedoExt),
  ];

  return {
    extension,
    get undoManager() { return currentUndoManager!; },
    getText: () => currentDoc?.getText('content')?.toString() ?? '',
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      destroyCurrent();
    },
    setView: (v: EditorView) => { view = v; },
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
