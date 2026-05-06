import { syntaxTree } from '@codemirror/language';
import { Range } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number
  ) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from;
  }

  toDOM(view: EditorView) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className = 'cm-task-checkbox';
    input.addEventListener('click', (e) => {
      e.preventDefault();
      const insert = this.checked ? '[ ]' : '[x]';
      view.dispatch({
        changes: { from: this.from, to: this.from + 3, insert },
      });
    });
    return input;
  }

  ignoreEvent() {
    // Let the widget handle its own click; don't forward to the editor.
    return true;
  }
}

/**
 * Renders GFM task list markers (`[ ]` / `[x]`) as real checkbox widgets,
 * regardless of cursor position. Lines whose marker is checked get a
 * `cm-task-checked` class so the theme can strike them through.
 */
export const taskListPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView) {
      const decorations: Range<Decoration>[] = [];
      const { state } = view;
      const ranges = state.selection.ranges;
      const tree = syntaxTree(state);

      // Iterate only the visible viewport ranges. On a 1.5MB file, walking the
      // full tree on every selection/viewport change costs hundreds of ms and
      // throttles cursor movement to a few updates per second.
      for (const { from, to } of view.visibleRanges) {
        tree.iterate({
          from,
          to,
          enter: (node) => {
            if (node.name !== 'TaskMarker') return;

            const text = state.doc.sliceString(node.from, node.to);
            const checked = /^\[[xX]\]$/.test(text);

            const line = state.doc.lineAt(node.from);
            const prefix = state.doc.sliceString(line.from, node.from);
            const bulletMatch = prefix.match(/^(\s*)(?:[-*+]|\d+[.)])\s+$/);
            const replaceFrom = bulletMatch
              ? line.from + bulletMatch[1].length
              : node.from;

            const cursorOnMarker = ranges.some(
              (r) => r.from <= node.to && r.to >= replaceFrom
            );

            if (!cursorOnMarker) {
              decorations.push(
                Decoration.replace({
                  widget: new CheckboxWidget(checked, node.from),
                }).range(replaceFrom, node.to)
              );
            }

            if (checked) {
              const after = state.doc.sliceString(node.to, line.to);
              const leadingWs = after.match(/^\s*/)?.[0].length ?? 0;
              const markFrom = node.to + leadingWs;
              if (markFrom < line.to) {
                decorations.push(
                  Decoration.mark({ class: 'cm-task-checked' }).range(markFrom, line.to)
                );
              }
            }
          },
        });
      }

      return Decoration.set(
        decorations.sort((a, b) => a.from - b.from),
        true
      );
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        return view.plugin(plugin)?.decorations || Decoration.none;
      }),
  }
);
