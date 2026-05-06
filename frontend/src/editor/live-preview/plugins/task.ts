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
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = this.build(update.view);
      }
    }

    build(view: EditorView) {
      const decorations: Range<Decoration>[] = [];
      const { state } = view;

      syntaxTree(state).iterate({
        enter: (node) => {
          if (node.name !== 'TaskMarker') return;

          const text = state.doc.sliceString(node.from, node.to);
          const checked = /^\[[xX]\]$/.test(text);

          decorations.push(
            Decoration.replace({
              widget: new CheckboxWidget(checked, node.from),
            }).range(node.from, node.to)
          );

          if (checked) {
            const line = state.doc.lineAt(node.from);
            decorations.push(
              Decoration.line({ class: 'cm-task-checked' }).range(line.from)
            );
          }
        },
      });

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
