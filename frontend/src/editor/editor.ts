/**
 * Editor — creates CodeMirror 6 instances with all extensions.
 *
 * Each call to createEditor() returns an independent EditorInstance
 * with its own view and cleanup. No global state.
 */

import { EditorState, Facet, type Extension } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo as cmUndo, redo as cmRedo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

import {
  collapseOnSelectionFacet,
  mouseSelectingField,
  setMouseSelecting,
  livePreviewPlugin,
  markdownStylePlugin,
  codeBlockField,
  imageField,
  linkPlugin,
  editorTheme,
} from './live-preview/index';

import { markdownFolding } from './folding';
import { Vim } from '@replit/codemirror-vim';

import { vimMode } from './vim';
import { createSyncSession, type SyncSession } from './sync';

interface UndoRedoProvider {
  undo(): boolean;
  redo(): boolean;
}

const undoRedoFacet = Facet.define<UndoRedoProvider, UndoRedoProvider | null>({
  combine: (inputs) => inputs[0] ?? null,
});

Vim.defineAction('undo', (cm: any, actionArgs: any) => {
  const view = cm.cm6;
  const provider = view.state.facet(undoRedoFacet);
  for (let i = 0; i < (actionArgs.repeat || 1); i++) {
    if (provider) {
      provider.undo();
    } else {
      cmUndo(view);
    }
  }
});

Vim.defineAction('redo', (cm: any, actionArgs: any) => {
  const view = cm.cm6;
  const provider = view.state.facet(undoRedoFacet);
  for (let i = 0; i < (actionArgs.repeat || 1); i++) {
    if (provider) {
      provider.redo();
    } else {
      cmRedo(view);
    }
  }
});

function buildExtensions(vimrcContent?: string, useSync = false): Extension[] {
  return [
    vimMode(vimrcContent),

    ...(useSync ? [] : [history()]),
    EditorView.lineWrapping,
    drawSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),

    keymap.of([
      ...defaultKeymap,
      ...(useSync ? [] : historyKeymap),
      ...searchKeymap,
    ]),

    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

    collapseOnSelectionFacet.of(true),
    mouseSelectingField,
    editorTheme,
    markdownStylePlugin,

    EditorView.domEventHandlers({
      keydown: (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
        }
        return false;
      },
      mousedown: (_event, view) => {
        view.dispatch({ effects: setMouseSelecting.of(true) });
        const onUp = () => {
          view.dispatch({ effects: setMouseSelecting.of(false) });
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mouseup', onUp);
        return false;
      },
    }),

    markdownFolding(),
  ];
}

export interface EditorOptions {
  initialDoc?: string;
  vimrcContent?: string;
  syncDocPath?: string;
  syncServerUrl?: string;
  readOnly?: boolean;
  apiKey?: string;
  onDocChange?: (content: string) => void;
}

export interface EditorInstance {
  view: EditorView;
  destroy: () => void;
}

export function createEditor(container: HTMLElement, options: EditorOptions = {}): EditorInstance {
  const useSync = !!(options.syncDocPath && options.syncServerUrl);
  const extensions = buildExtensions(options.vimrcContent, useSync);

  let syncSession: SyncSession | null = null;

  if (options.syncDocPath && options.syncServerUrl) {
    syncSession = createSyncSession(options.syncDocPath, options.syncServerUrl, options.apiKey, options.initialDoc);
    extensions.push(syncSession.extension);
    const um = syncSession.undoManager;
    extensions.push(undoRedoFacet.of({
      undo: () => um.undo() != null,
      redo: () => um.redo() != null,
    }));
  }

  if (options.onDocChange) {
    const cb = options.onDocChange;
    extensions.push(EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        cb(update.state.doc.toString());
      }
    }));
  }

  if (options.readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  const state = EditorState.create({
    doc: options.initialDoc ?? '',
    extensions,
  });

  const view = new EditorView({
    state,
    parent: container,
  });

  return {
    view,
    destroy: () => {
      syncSession?.destroy();
      view.destroy();
    },
  };
}
