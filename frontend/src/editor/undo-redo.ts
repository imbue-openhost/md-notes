import { EditorView, type KeyBinding } from '@codemirror/view';
import { undo as cmUndo, redo as cmRedo } from './commands/commands';
import { undoRedoFacet } from './sync';

// When a doc is syncing, undo/redo must go through the CRDT's Y.UndoManager
// (plain CM history would fight the shared doc state); otherwise fall back
// to CodeMirror history.

export function syncAwareUndo(view: EditorView): boolean {
  const provider = view.state.facet(undoRedoFacet);
  if (provider) {
    provider.undo();
    return true;
  }
  return cmUndo(view);
}

export function syncAwareRedo(view: EditorView): boolean {
  const provider = view.state.facet(undoRedoFacet);
  if (provider) {
    provider.redo();
    return true;
  }
  return cmRedo(view);
}

/** Replacement for historyKeymap on synced docs. */
export const syncHistoryKeymap: readonly KeyBinding[] = [
  { key: 'Mod-z', run: syncAwareUndo, preventDefault: true },
  { key: 'Mod-y', mac: 'Mod-Shift-z', run: syncAwareRedo, preventDefault: true },
  { linux: 'Ctrl-Shift-z', run: syncAwareRedo, preventDefault: true },
];
