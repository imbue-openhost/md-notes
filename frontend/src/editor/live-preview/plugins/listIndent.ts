import { syntaxTree } from '@codemirror/language';
import { Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';

// Each level of list nesting renders as this many character widths of indent,
// regardless of the source's actual indent (2 spaces, 4 spaces, tabs, …).
const VISUAL_INDENT = 4;

/**
 * Visually scales list-item indentation by the nesting level reported by the
 * markdown parser, and gives each list line a hanging indent so wrapped
 * continuation lines align with the bullet's text rather than the left margin.
 *
 * Nesting: each list line gets enough extra `margin-left` so that nesting
 * depth N renders at `(N-1) * VISUAL_INDENT` character widths from the line
 * start. If the source already indents past the target, no margin is added.
 *
 * Hanging indent: for every list line we set `text-indent: -<bulletWidth>ch`
 * combined with `padding-left: calc(16px + <bulletWidth>ch)` (16px matches
 * the theme's `.cm-line` left padding). The first rendered line is pulled
 * back to the normal start by the negative text-indent; wrapped lines aren't
 * affected by text-indent and so begin at the bullet-text column.
 */
export const listVisualIndentPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView) {
      const decorations: Range<Decoration>[] = [];
      const { state } = view;
      const tree = syntaxTree(state);

      for (const { from, to } of view.visibleRanges) {
        // tree.iterate fires `enter` for every overlapping ancestor, so we
        // can start at 0 and let the enter/leave callbacks track depth —
        // any list containing the visible range will itself overlap and
        // be entered.
        let listDepth = 0;

        tree.iterate({
          from,
          to,
          enter: (n) => {
            if (n.name === 'BulletList' || n.name === 'OrderedList') {
              listDepth++;
            } else if (n.name === 'ListMark') {
              const line = state.doc.lineAt(n.from);
              const sourceIndent = /^[ \t]*/.exec(line.text)![0].length;
              const markerLen = n.to - n.from;
              // Whitespace immediately after the marker (typically one space).
              const afterMarker = line.text.slice(n.to - line.from);
              const wsAfterMarker = /^[ \t]*/.exec(afterMarker)![0].length;
              const bulletWidth = sourceIndent + markerLen + wsAfterMarker;

              const target = (listDepth - 1) * VISUAL_INDENT;
              const nestPadding = Math.max(0, target - sourceIndent);

              // margin-left — not padding-left — for nesting, so wrapped
              // lines also shift right with the bullet. padding-left here
              // drives the hanging indent; text-indent's negative value
              // pulls the first line back to the normal start column.
              const style =
                `margin-left: ${nestPadding}ch;` +
                `text-indent: -${bulletWidth}ch;` +
                `padding-left: calc(16px + ${bulletWidth}ch);`;

              decorations.push(
                Decoration.line({
                  attributes: { style },
                }).range(line.from),
              );
            }
          },
          leave: (n) => {
            if (n.name === 'BulletList' || n.name === 'OrderedList') {
              listDepth--;
            }
          },
        });
      }

      return Decoration.set(decorations, true);
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
