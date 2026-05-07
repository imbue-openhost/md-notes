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
 * markdown parser. Source content is unchanged; each list line gets enough
 * `padding-left` so that nesting depth N renders at `(N-1) * VISUAL_INDENT`
 * character widths from the line start.
 *
 * If the source already indents past the target (e.g. 4-space source for a
 * level-2 item where the target is also 4), no padding is added — we never
 * try to negatively offset.
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
        // Establish the list-nesting depth at the start of the visible range
        // (we may begin iteration partway inside a deeply-nested list).
        let listDepth = 0;
        for (
          let n = tree.resolveInner(from, 1).parent;
          n;
          n = n.parent
        ) {
          if (n.name === 'BulletList' || n.name === 'OrderedList') listDepth++;
        }

        tree.iterate({
          from,
          to,
          enter: (n) => {
            if (n.name === 'BulletList' || n.name === 'OrderedList') {
              listDepth++;
            } else if (n.name === 'ListMark') {
              const line = state.doc.lineAt(n.from);
              const sourceIndent = /^[ \t]*/.exec(line.text)![0].length;
              const target = (listDepth - 1) * VISUAL_INDENT;
              const padding = target - sourceIndent;
              if (padding > 0) {
                decorations.push(
                  Decoration.line({
                    attributes: { style: `padding-left: ${padding}ch` },
                  }).range(line.from),
                );
              }
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
