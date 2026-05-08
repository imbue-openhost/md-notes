import { syntaxTree } from '@codemirror/language';
import { EditorState, Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';

// Visual width per source-indent character. Pairs with the project's
// 2-space-per-level indent convention to put each level at 4ch from the
// previous bullet column.
const INDENT_CH = 2;
// Width of the bullet column. Must match `.cm-bullet { width }` in the theme.
const BULLET_COL = 1;

class IndentSpacer extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-list-indent-ws';
    return span;
  }
  eq() { return true; }
  ignoreEvent() { return false; }
}

const indentSpacer = Decoration.replace({ widget: new IndentSpacer() });

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

          // Replace each leading whitespace char with a fixed-width spacer
          // widget. Per-char (rather than collapsing the whole prefix into a
          // single replace) is what gives the cursor a landing position at
          // every char boundary — and the explicit width keeps the bullet
          // column stable across cursor moves and proportional-font sizing.
          for (let i = 0; i < sourceIndent; i++) {
            decorations.push(indentSpacer.range(line.from + i, line.from + i + 1));
          }
          // Post-marker space replaced empty so wrapped continuation lines
          // line up with the first-line text and there's no extra gap.
          if (wsAfterMarker > 0) {
            decorations.push(
              Decoration.replace({}).range(n.to, n.to + wsAfterMarker),
            );
          }

          // padding-left puts wrapped continuation at the bullet text
          // column. text-indent pulls the first line back so the leading
          // spacers (and then the bullet widget) start at the line edge.
          const prefixCh = sourceIndent * INDENT_CH + BULLET_COL;
          const style =
            `text-indent: -${prefixCh}ch;` +
            `padding-left: calc(16px + ${prefixCh}ch);`;

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
