/**
 * Editor — sets up the CodeMirror 6 instance with all extensions.
 */

import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

// Live preview (inlined from codemirror-live-markdown)
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

// Local extensions
import { markdownFolding } from './folding';
import { vimMode } from './vim';
import { initSync, destroySync } from './sync';

let editorView: EditorView | null = null;

const SAMPLE_MD = `# Welcome to md-notes

This is a **live preview** markdown editor with _vim mode_ enabled.

## Features

- **Bold** and *italic* text
- [Links](https://example.com) render inline
- Code blocks with syntax highlighting
- Header-based folding (click the gutter)

### Code Example

\`\`\`javascript
function hello(name) {
  console.log(\`Hello, \${name}!\`);
  return true;
}
\`\`\`

### Lists

1. First item
2. Second item
3. Third item

> Blockquotes are styled too.

---

Inline \`code\` works as well. Try moving your cursor around to see the
live preview toggle between source and rendered output.
`;

/**
 * Build the full extension set for the markdown editor.
 */
function buildExtensions(vimrcContent?: string, useSync = false): Extension[] {
  return [
    // Vim mode first so it captures keys before other keymaps
    vimMode(vimrcContent),

    // Core editing — skip CM6 history when Yjs sync is active
    // (yCollab provides its own Y.UndoManager)
    ...(useSync ? [] : [history()]),
    drawSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    lineNumbers(),

    // Keymaps
    keymap.of([
      ...defaultKeymap,
      ...(useSync ? [] : historyKeymap),
      ...searchKeymap,
    ]),

    // Markdown language support
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

    // Live preview
    collapseOnSelectionFacet.of(true),
    mouseSelectingField,
    editorTheme,
    livePreviewPlugin,
    markdownStylePlugin,
    codeBlockField(),
    imageField(),
    linkPlugin(),

    // Mouse selecting tracking for live preview
    EditorView.domEventHandlers({
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

    // Folding
    markdownFolding(),
  ];
}

/**
 * Create and mount the editor in the given container element.
 */
export interface EditorOptions {
  initialDoc?: string;
  vimrcContent?: string;
  /** If set, enables Yjs sync for this document path. */
  syncDocPath?: string;
  /** Server URL for Yjs sync (e.g., "http://localhost:8080"). */
  syncServerUrl?: string;
  /** If true, editor is read-only (for read-only share links). */
  readOnly?: boolean;
}

export function createEditor(container: HTMLElement, options: EditorOptions = {}): EditorView {
  editorContainer = container;
  currentOptions = options;

  if (editorView) {
    destroySync();
    editorView.destroy();
  }

  const useSync = !!(options.syncDocPath && options.syncServerUrl);
  const extensions = buildExtensions(options.vimrcContent, useSync);

  // Add Yjs sync if configured
  if (options.syncDocPath && options.syncServerUrl) {
    const sync = initSync(options.syncDocPath, options.syncServerUrl);
    extensions.push(sync.extension);
  }

  if (options.readOnly) {
    extensions.push(EditorState.readOnly.of(true));
  }

  const state = EditorState.create({
    doc: options.syncDocPath ? '' : (options.initialDoc ?? SAMPLE_MD),
    extensions,
  });

  editorView = new EditorView({
    state,
    parent: container,
  });

  return editorView;
}

/**
 * Replace the editor content with new text (e.g., when opening a file).
 */
export function setEditorContent(content: string): void {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: content },
  });
}

/**
 * Get the current editor document as a string.
 */
export function getEditorContent(): string {
  return editorView?.state.doc.toString() ?? '';
}

// Store the container so openDocument() can re-create the editor.
let editorContainer: HTMLElement | null = null;
let currentOptions: EditorOptions = {};

/**
 * Open a document by path via Yjs sync, tearing down any existing session.
 */
export function openDocument(
  path: string,
  serverUrl: string,
  opts: Pick<EditorOptions, 'vimrcContent' | 'readOnly'> = {},
): EditorView {
  if (!editorContainer) {
    throw new Error('Editor not initialised — call createEditor() first');
  }
  return createEditor(editorContainer, {
    ...currentOptions,
    ...opts,
    syncDocPath: path,
    syncServerUrl: serverUrl,
  });
}

/**
 * Get the current EditorView instance.
 */
export function getEditorView(): EditorView | null {
  return editorView;
}
