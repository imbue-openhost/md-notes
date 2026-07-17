import { syntaxTree } from '@codemirror/language';
import { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';
import { shouldShowSource } from '../core/shouldShowSource';
import { checkUpdateAction } from '../core/pluginUpdateHelper';

/**
 * Parent node types to skip
 * Marks inside these nodes should not be processed
 */
const SKIP_PARENT_TYPES = new Set(['FencedCode', 'CodeBlock']);

/**
 * Check if node is inside a skipped parent
 */
function isInsideSkippedParent(node: {
  node: { parent: { name: string; parent: unknown } | null };
}): boolean {
  let parent = node.node.parent;
  while (parent) {
    if (SKIP_PARENT_TYPES.has(parent.name)) {
      return true;
    }
    parent = parent.parent as { name: string; parent: unknown } | null;
  }
  return false;
}

/**
 * Inline marks revealed when the selection touches the enclosing styled
 * span (StrongEmphasis, Emphasis, Strikethrough, InlineCode) — so clicking
 * anywhere inside **bold** shows the `**`, not just clicking the marks.
 */
const INLINE_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark']);

/**
 * Live-preview mark decorations: hide formatting marks with replace
 * decorations (the same mechanism taskListPlugin and codeBlockField use —
 * unlike the old CSS font-size hack it doesn't break CM6 coordinate
 * scanning under vim), and reveal them when the selection is nearby.
 *
 * - `#`/`>` marks: revealed while the selection touches their line
 * - inline marks: revealed while the selection touches the styled span
 * - ListMark and code blocks are handled by other plugins, skipped here
 */
export function buildLivePreviewDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[]
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === 'HeaderMark' || node.name === 'QuoteMark') {
          // Setext underlines (`===`) are their own line; leave them alone.
          if (node.name === 'HeaderMark') {
            const parent = node.node.parent;
            if (!parent || !parent.name.startsWith('ATXHeading')) return;
          }

          const line = state.doc.lineAt(node.from);
          if (shouldShowSource(state, line.from, line.to)) {
            decorations.push(
              Decoration.mark({ class: 'cm-formatting-mark' }).range(
                node.from,
                node.to
              )
            );
          } else {
            // Hide the separating space too: the one after an opening
            // mark, or before a closing ATX mark (`## foo ##`).
            let hideFrom = node.from;
            let hideTo = node.to;
            const atLineStart = /^\s*$/.test(
              line.text.slice(0, node.from - line.from)
            );
            if (atLineStart) {
              if (state.doc.sliceString(hideTo, hideTo + 1) === ' ') hideTo++;
            } else if (state.doc.sliceString(hideFrom - 1, hideFrom) === ' ') {
              hideFrom--;
            }
            decorations.push(Decoration.replace({}).range(hideFrom, hideTo));
          }
          return;
        }

        if (!INLINE_MARKS.has(node.name)) return;
        if (node.from >= node.to) return;
        if (isInsideSkippedParent(node)) return;

        const parent = node.node.parent;
        const spanFrom = parent ? parent.from : node.from;
        const spanTo = parent ? parent.to : node.to;

        if (shouldShowSource(state, spanFrom, spanTo)) {
          decorations.push(
            Decoration.mark({ class: 'cm-formatting-mark' }).range(
              node.from,
              node.to
            )
          );
        } else {
          decorations.push(Decoration.replace({}).range(node.from, node.to));
        }
      },
    });
  }

  return Decoration.set(
    decorations.sort((a, b) => a.from - b.from || a.to - b.to),
    true
  );
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(
        view.state,
        view.visibleRanges
      );
    }

    update(update: ViewUpdate) {
      if (checkUpdateAction(update) === 'rebuild') {
        this.decorations = buildLivePreviewDecorations(
          update.view.state,
          update.view.visibleRanges
        );
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
