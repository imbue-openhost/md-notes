/**
 * Editor — creates CodeMirror 6 instances with all extensions.
 *
 * Each call to createEditor() returns an independent EditorInstance
 * with its own view and cleanup. No global state.
 *
 * options.kind selects the editor flavor: 'live-preview' (default) uses
 * standard keybindings; 'live-preview-vim' layers vim on the same core.
 */

import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from './commands/commands';
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
  livePreviewPlugin,
  markdownStylePlugin,
  taskListPlugin,
  listVisualIndentPlugin,
  spaceWidthField,
  spaceWidthMeasurer,
  codeBlockField,
  linkPlugin,
  editorTheme,
} from './live-preview/index';

import { markdownFolding } from './folding';
import { foldPersistence } from './fold-persistence';
import { headerAnchorJump } from './header-anchor';
import { headerLinkButtons, type GetShareUrl } from './header-link-button';
import { indentDetection } from './indent/indentUnitField';
import { pasteIndentNormalization } from './indent/pasteIndent';

import { vimMode } from './vim';
import { toggleTaskAtSelection } from './tasks';
import { syncHistoryKeymap } from './undo-redo';
import { foldChevrons } from './foldChevrons';
import { mobileTheme } from './mobile/theme';
import type { EditorKind } from './editor-settings';
import { createSyncSession, createShareSyncSession, type SyncSession } from './sync';

export type { EditorKind };

function buildExtensions(kind: EditorKind, vimrcContent: string | undefined, useSync: boolean, touch: boolean): Extension[] {
  return [
    // Virtual keyboards want the platform text services that physical-keyboard
    // editing usually leaves off.
    ...(touch
      ? [EditorView.contentAttributes.of({
          autocapitalize: 'sentences',
          autocorrect: 'on',
          spellcheck: 'true',
        })]
      : []),

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

    ...(kind === 'live-preview-vim' ? [vimMode(vimrcContent)] : []),

    ...(useSync ? [] : [history()]),
    EditorView.lineWrapping,
    drawSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),

    // defaultKeymap is the main map for the standard editor and provides the
    // insert-mode basics (Backspace, Enter, arrow keys, etc.) that vim's
    // insert mode falls through to. Undo/redo goes through the CRDT undo
    // manager on synced docs, plain CM history otherwise.
    keymap.of([
      ...defaultKeymap,
      ...(useSync ? syncHistoryKeymap : historyKeymap),
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
    ...(kind === 'live-preview-mobile' ? [mobileTheme] : []),
    foldChevrons(kind === 'live-preview-mobile' ? 'cursor' : 'hover'),
    indentDetection(),
    pasteIndentNormalization(),
    spaceWidthField,
    spaceWidthMeasurer,
    markdownStylePlugin,
    livePreviewPlugin,
    linkPlugin(),
    taskListPlugin,
    listVisualIndentPlugin,
    codeBlockField({ interaction: 'inline' }),

    EditorView.domEventHandlers({
      // Dockview sets its panel JSON ({"viewId","groupId","panelId"}) as
      // text/plain on tab drags; without this guard CodeMirror inserts it.
      drop: (event) => {
        const text = event.dataTransfer?.getData('text/plain');
        if (text) {
          try {
            const obj = JSON.parse(text);
            if (obj && typeof obj === 'object' && 'panelId' in obj) {
              event.preventDefault();
              return true;
            }
          } catch {}
        }
        return false;
      },
      keydown: (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
        }
        return false;
      },
      mousedown: (_event, view) => {
        view.dispatch({ effects: setMouseSelecting.of(true) });
        const onUp = () => {
          // Re-assert the (unchanged) selection: the drag-end rebuild reveals
          // formatting marks and shifts the line's text, and without a
          // selection in this transaction the cursor layer may keep a stale
          // caret position/paint until some later event.
          view.dispatch({
            effects: setMouseSelecting.of(false),
            selection: view.state.selection,
          });
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
  /** Editor flavor; defaults to 'live-preview' (standard keybindings). */
  kind?: EditorKind;
  /** Only used when kind is 'live-preview-vim'. */
  vimrcContent?: string;
  /** Touch-device editing: enables autocapitalize/autocorrect/spellcheck. */
  touch?: boolean;
  syncVault?: string;
  syncFilePath?: string;
  syncServerUrl?: string;
  shareUuid?: string;
  shareDocPath?: string;
  readOnly?: boolean;
  /** Header slug (or raw header text) to jump to once the doc has loaded. */
  anchorHeader?: string;
  /** When set, heading lines get a hover button that copies a share link to that section. */
  getShareUrl?: GetShareUrl;
  onDocChange?: (content: string) => void;
  /** Called when the initial server handshake fails (timeout or connection error). */
  onSyncFailed?: (error: Error) => void;
}

export interface EditorInstance {
  view: EditorView;
  /** Resolves once the doc content is authoritative (first server sync; immediate when not syncing).
   * Never rejects — sync failure is surfaced via onSyncFailed. */
  ready: Promise<void>;
  destroy: () => void;
}

export function createEditor(container: HTMLElement, options: EditorOptions = {}): EditorInstance {
  const kind = options.kind ?? 'live-preview';
  const useSync = !!(options.syncServerUrl && (options.syncVault || options.shareUuid));
  const extensions = buildExtensions(kind, options.vimrcContent, useSync, options.touch ?? false);

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

  if (options.anchorHeader) {
    extensions.push(headerAnchorJump(options.anchorHeader));
  }

  // Header link buttons are hover-revealed, which has no touch equivalent;
  // mobile shares via the drawer's Share button instead.
  if (options.getShareUrl && kind !== 'live-preview-mobile') {
    extensions.push(headerLinkButtons(options.getShareUrl));
  }

  const state = EditorState.create({
    doc: '',
    extensions,
  });

  const view = new EditorView({
    state,
    parent: container,
  });

  // Password-manager extensions (e.g. iCloud Passwords) listen for these keys
  // on document and forward them to their autofill dropdown when they think
  // one is open — a stale dropdown request turns Enter into "Open Passwords
  // app". The editor fully handles these keys, so hide them from page-level
  // listeners. (A raw bubble listener on view.dom, because CM's keymaps stop
  // running domEventHandlers once a key is handled.)
  view.dom.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'Enter':
      case 'Escape':
      case 'ArrowUp':
      case 'ArrowDown':
        event.stopPropagation();
    }
  });

  // Block input until the sync session reports a successful first handshake
  // with the server. Until then we don't know whether what we're showing
  // matches the doc's authoritative state, and IDB alone isn't sufficient
  // (see the comment block at the top of sync.ts). The overlay sits above the
  // editor and is removed once the doc is known to be current.
  let overlay: HTMLDivElement | null = null;
  if (syncSession) {
    const containerStyle = window.getComputedStyle(container);
    if (containerStyle.position === 'static') {
      container.style.position = 'relative';
    }
    overlay = document.createElement('div');
    overlay.className = 'editor-sync-overlay';
    overlay.textContent = 'Connecting…';
    container.appendChild(overlay);

    syncSession.ready.then(() => {
      overlay?.remove();
      overlay = null;
    }).catch((err: Error) => {
      // Leave the overlay (now showing an error) so the panel renders
      // something coherent until the caller closes it via onSyncFailed.
      if (overlay) {
        overlay.textContent = "Can't reach backend.";
        overlay.classList.add('editor-sync-overlay-error');
      }
      options.onSyncFailed?.(err);
    });
  }

  let destroyed = false;
  return {
    view,
    ready: syncSession ? syncSession.ready.catch(() => {}) : Promise.resolve(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      overlay?.remove();
      overlay = null;
      syncSession?.destroy();
      view.destroy();
    },
  };
}
