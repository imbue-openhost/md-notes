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
function buildExtensions(): Extension[] {
  return [
    // Vim mode first so it captures keys before other keymaps
    vimMode(),

    // Core editing
    history(),
    drawSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    lineNumbers(),

    // Keymaps
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),

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
export function createEditor(container: HTMLElement, initialDoc?: string): EditorView {
  if (editorView) {
    editorView.destroy();
  }

  const state = EditorState.create({
    doc: initialDoc ?? SAMPLE_MD,
    extensions: buildExtensions(),
  });

  editorView = new EditorView({
    state,
    parent: container,
  });

  return editorView;
}

/**
 * Get the current EditorView instance.
 */
export function getEditorView(): EditorView | null {
  return editorView;
}
