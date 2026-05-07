/**
 * Editor — creates CodeMirror 6 instances with all extensions.
 *
 * Each call to createEditor() returns an independent EditorInstance
 * with its own view and cleanup. No global state.
 */

import { EditorState, Facet, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo as cmUndo, redo as cmRedo } from '@codemirror/commands';
import { markdown, markdownLanguage } from './lang-markdown/index';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, foldNodeProp } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';

// defaultHighlightStyle underlines headings; we want bold-only.
const headingOverride = HighlightStyle.define([
  { tag: tags.heading, textDecoration: 'none' },
]);

const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

function selectedLineRange(view: EditorView): { startLineNum: number; endLineNum: number } {
  const { state } = view;
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from);
  const endLine = state.doc.lineAt(sel.to);
  // Visual-line selections often end at the start of the line *after* the
  // last visually-selected line. Don't include that trailing line.
  const endLineNum =
    sel.to > sel.from && sel.to === endLine.from && endLine.number > startLine.number
      ? endLine.number - 1
      : endLine.number;
  return { startLineNum: startLine.number, endLineNum };
}

/**
 * Tab on a list line indents that line by one level (2 spaces). With a
 * multi-line selection, every selected list line is indented; non-list
 * lines in the selection are left alone. Returns false when nothing in
 * the selection is a list line, so default Tab behaviour still runs.
 */
function indentListLines(view: EditorView): boolean {
  const { state } = view;
  const { startLineNum, endLineNum } = selectedLineRange(view);
  const changes: { from: number; insert: string }[] = [];
  for (let n = startLineNum; n <= endLineNum; n++) {
    const line = state.doc.line(n);
    if (LIST_LINE_RE.test(line.text)) {
      changes.push({ from: line.from, insert: '  ' });
    }
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
}

/**
 * Shift-Tab: dedent list line(s) by one level. Removes up to 2 leading
 * whitespace chars from each selected list line. Lines that aren't list
 * lines or have no leading whitespace are skipped; if no line gets
 * dedented, returns false so default Shift-Tab behaviour still runs.
 */
function dedentListLines(view: EditorView): boolean {
  const { state } = view;
  const { startLineNum, endLineNum } = selectedLineRange(view);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = startLineNum; n <= endLineNum; n++) {
    const line = state.doc.line(n);
    if (!LIST_LINE_RE.test(line.text)) continue;
    const ws = /^[ \t]*/.exec(line.text)![0];
    if (ws.length === 0) continue;
    const remove = Math.min(2, ws.length);
    changes.push({ from: line.from, to: line.from + remove, insert: '' });
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
}

import {
  collapseOnSelectionFacet,
  mouseSelectingField,
  setMouseSelecting,
  markdownStylePlugin,
  taskListPlugin,
  bulletListPlugin,
  listVisualIndentPlugin,
  editorTheme,
} from './live-preview/index';

import { markdownFolding } from './folding';
import { foldPersistence } from './fold-persistence';
import { Vim, getCM } from '@replit/codemirror-vim';

import { vimMode } from './vim';
import { createSyncSession, createShareSyncSession, type SyncSession } from './sync';

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
    // Run before vim so Tab/Shift-Tab on list lines work in any mode.
    Prec.highest(keymap.of([
      { key: 'Tab', run: indentListLines },
      { key: 'Shift-Tab', run: dedentListLines },
    ])),

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

    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      // Suppress lang-markdown's default folds for non-heading blocks
      // (ListItem, Blockquote, FencedCode, Table, …) so only headings fold.
      extensions: {
        props: [
          foldNodeProp.add({
            'CodeBlock FencedCode Blockquote HorizontalRule ListItem HTMLBlock LinkReference Paragraph CommentBlock ProcessingInstructionBlock Table': () => null,
          }),
        ],
      },
    }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    syntaxHighlighting(headingOverride),

    collapseOnSelectionFacet.of(true),
    mouseSelectingField,
    editorTheme,
    markdownStylePlugin,
    taskListPlugin,
    bulletListPlugin,
    listVisualIndentPlugin,

    EditorView.domEventHandlers({
      keydown: (event) => {
        if (event.ctrlKey && (event.key === 'd' || event.key === 'u') && !event.metaKey && !event.altKey) {
          // eslint-disable-next-line no-console
          console.log('[ctrl-d/u keydown@cm]', {
            key: event.key,
            code: event.code,
            ctrl: event.ctrlKey,
            shift: event.shiftKey,
            defaultPrevented: event.defaultPrevented,
          });
          queueMicrotask(() => {
            // eslint-disable-next-line no-console
            console.log('[ctrl-d/u keydown@microtask]', {
              key: event.key,
              defaultPrevented: event.defaultPrevented,
            });
          });
        }
        if (event.key === 'Escape') {
          event.preventDefault();
        }
        return false;
      },
      beforeinput: (event: InputEvent) => {
        if (event.inputType === 'deleteContentForward' || event.inputType === 'deleteContentBackward') {
          // eslint-disable-next-line no-console
          console.log('[beforeinput]', { inputType: event.inputType, data: event.data });
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
  vimrcContent?: string;
  syncVault?: string;
  syncFilePath?: string;
  syncServerUrl?: string;
  shareUuid?: string;
  shareDocPath?: string;
  readOnly?: boolean;
  onDocChange?: (content: string) => void;
}

export interface EditorInstance {
  view: EditorView;
  destroy: () => void;
}

export function createEditor(container: HTMLElement, options: EditorOptions = {}): EditorInstance {
  const useSync = !!(options.syncServerUrl && (options.syncVault || options.shareUuid));
  const extensions = buildExtensions(options.vimrcContent, useSync);

  let syncSession: SyncSession | null = null;

  if (options.syncServerUrl && options.syncVault && options.syncFilePath) {
    syncSession = createSyncSession(options.syncVault, options.syncFilePath, options.syncServerUrl);
  } else if (options.syncServerUrl && options.shareUuid && options.shareDocPath) {
    syncSession = createShareSyncSession(options.shareUuid, options.shareDocPath, options.syncServerUrl);
  }

  if (syncSession) {
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

  if (options.syncVault && options.syncFilePath) {
    extensions.push(foldPersistence({ vault: options.syncVault, filePath: options.syncFilePath }));
  }

  const state = EditorState.create({
    doc: '',
    extensions,
  });

  const view = new EditorView({
    state,
    parent: container,
  });

  const cmForLogging = getCM(view) as any;
  if (cmForLogging) {
    cmForLogging.on('vim-keypress', (key: string) => {
      if (key === '<C-d>' || key === '<C-u>') {
        // eslint-disable-next-line no-console
        console.log('[vim-keypress]', key);
      }
    });
    cmForLogging.on('inputEvent', (info: any) => {
      if (info && info.key && (info.key === '<C-d>' || info.key === '<C-u>')) {
        // eslint-disable-next-line no-console
        console.log('[vim inputEvent]', info);
      }
    });
  }

  let destroyed = false;
  return {
    view,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      syncSession?.destroy();
      view.destroy();
    },
  };
}
