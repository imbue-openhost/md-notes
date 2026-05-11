/**
 * Editor — creates CodeMirror 6 instances with all extensions.
 *
 * Each call to createEditor() returns an independent EditorInstance
 * with its own view and cleanup. No global state.
 */

import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, undo as cmUndo, redo as cmRedo } from './commands/commands';
import { markdown, markdownLanguage, toggleBold, insertNewlineInListCodeBlock } from './lang-markdown/index';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, foldNodeProp } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';

// defaultHighlightStyle underlines headings; we want bold-only.
const headingOverride = HighlightStyle.define([
  { tag: tags.heading, textDecoration: 'none' },
]);

import { handleTab, handleShiftTab } from './tab';

import {
  collapseOnSelectionFacet,
  mouseSelectingField,
  setMouseSelecting,
  markdownStylePlugin,
  taskListPlugin,
  listVisualIndentPlugin,
  spaceWidthField,
  spaceWidthMeasurer,
  codeBlockField,
  editorTheme,
} from './live-preview/index';

import { markdownFolding } from './folding';
import { foldPersistence } from './fold-persistence';
import { indentDetection } from './indent/indentUnitField';
import { Vim } from '@replit/codemirror-vim';

import { vimMode, toggleTaskAtSelection } from './vim';
import { createSyncSession, createShareSyncSession, undoRedoFacet, type SyncSession } from './sync';

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
    // Run before vim so Tab/Shift-Tab are always consumed by the editor
    // (regardless of vim mode), never bubbling to the browser. Mod-b also
    // wins over the browser default here.
    Prec.highest(keymap.of([
      { key: 'Tab', run: handleTab, preventDefault: true },
      { key: 'Shift-Tab', run: handleShiftTab, preventDefault: true },
      { key: 'Mod-b', run: toggleBold, preventDefault: true },
      { key: 'Mod-l', run: (view) => toggleTaskAtSelection(view), preventDefault: true },
      // Enter inside a code block nested in a list item: keep the new
      // line indented to the parent list's content column, or close out
      // and continue the list when on the closing fence line.
      { key: 'Enter', run: insertNewlineInListCodeBlock },
    ])),

    vimMode(vimrcContent),

    ...(useSync ? [] : [history()]),
    EditorView.lineWrapping,
    drawSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),

    // defaultKeymap provides insert-mode basics (Backspace, Enter, arrow keys, etc.)
    // that vim's insert mode falls through to. historyKeymap adds Cmd-z/Shift-Cmd-z
    // on top of vim's u/Ctrl-r.
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
    indentDetection(),
    spaceWidthField,
    spaceWidthMeasurer,
    markdownStylePlugin,
    taskListPlugin,
    listVisualIndentPlugin,
    codeBlockField({ interaction: 'inline' }),

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
