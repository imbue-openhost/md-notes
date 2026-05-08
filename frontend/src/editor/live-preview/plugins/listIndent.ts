import { syntaxTree } from '@codemirror/language';
import { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view';

// Each level of list nesting renders this many character widths from the
// previous level's bullet column.
const VISUAL_INDENT = 4;
// Reserved column width (in `ch`) for the bullet glyph + its trailing gap.
// Must match `.cm-bullet { width }` in the theme — the value is what
// text-indent compensates for to produce the hanging indent.
const BULLET_COL = 2;

/**
 * Builds the list-indent decorations for a given state and visible ranges.
 * Exported so unit tests can exercise it without a live EditorView.
 */
export function buildListIndentDecorations(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[],
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);
  const ranges = state.selection.ranges;

  for (const { from, to } of visibleRanges) {
    // tree.iterate fires `enter` for every overlapping ancestor, so we can
    // start at 0 and let the enter/leave callbacks track depth — any list
    // containing the visible range will itself overlap and be entered.
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
          const afterMarker = line.text.slice(n.to - line.from);
          const wsAfterMarker = /^[ \t]*/.exec(afterMarker)![0].length;
          const levelIndent = (listDepth - 1) * VISUAL_INDENT;

          // Hide leading whitespace and the space after the marker so the
          // bullet/checkbox widget is the only visible glyph in the prefix.
          // Their widths in proportional fonts are not 1ch, so leaving them
          // visible makes text-indent over- or under-compensate. Reveal the
          // raw source whenever the cursor sits anywhere in the prefix
          // region (line start through the post-marker space) so the user
          // can put the cursor in the leading whitespace and edit it.
          const prefixEnd = n.to + wsAfterMarker;
          const cursorInPrefix = ranges.some(
            (r) => r.from <= prefixEnd && r.to >= line.from,
          );
          if (!cursorInPrefix) {
            if (sourceIndent > 0) {
              decorations.push(
                Decoration.replace({}).range(line.from, line.from + sourceIndent),
              );
            }
            if (wsAfterMarker > 0) {
              decorations.push(
                Decoration.replace({}).range(n.to, n.to + wsAfterMarker),
              );
            }
          }

          // padding-left puts wrapped continuation lines at the bullet text
          // column. text-indent pulls the first line back to the bullet
          // column itself; since the leading source whitespace and the
          // post-marker space are now zero-width replacements, the bullet
          // widget is char[0] and -BULLET_COL ch lands it exactly at
          // 16px + levelIndent.
          const style =
            `text-indent: -${BULLET_COL}ch;` +
            `padding-left: calc(16px + ${levelIndent + BULLET_COL}ch);`;

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

/**
 * Visually scales list-item indentation by the parser's nesting depth, and
 * gives each list line a hanging indent so wrapped continuation lines align
 * with the bullet's text rather than the line edge.
 *
 * The plugin sets `padding-left` and `text-indent` on each list line so:
 *   - the bullet sits at `(depth-1) * VISUAL_INDENT` ch from line start
 *   - wrapped continuation lines start at the bullet text column
 *
 * To keep alignment deterministic in proportional fonts (where each source
 * character's width != 1ch), the leading whitespace and the space following
 * the marker are replaced by zero-width decorations, and the bullet widget
 * itself has a fixed `BULLET_COL`-ch width (set in the theme). This way
 * `text-indent: -BULLET_COL ch` compensates exactly for the bullet's box,
 * regardless of which characters the source happens to contain.
 */
export const listVisualIndentPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildListIndentDecorations(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildListIndentDecorations(
          update.state,
          update.view.visibleRanges,
        );
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);
