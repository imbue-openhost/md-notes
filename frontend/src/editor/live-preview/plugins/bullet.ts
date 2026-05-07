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

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-bullet';
    span.textContent = '•';
    return span;
  }
  eq() { return true; }
  ignoreEvent() { return false; }
}

const bulletDeco = Decoration.replace({ widget: new BulletWidget() });

/**
 * Renders `-` unordered list markers as bullets (•). The literal dash is shown
 * when the cursor is on or adjacent to the marker, mirroring the task-list
 * plugin's reveal-on-cursor behavior.
 */
export const bulletListPlugin = ViewPlugin.fromClass(
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

      for (const { from, to } of view.visibleRanges) {
        tree.iterate({
          from,
          to,
          enter: (node) => {
            if (node.name !== 'ListMark') return;

            if (state.doc.sliceString(node.from, node.to) !== '-') return;

            // Skip task list items — taskListPlugin already replaces the bullet.
            const line = state.doc.lineAt(node.from);
            const after = state.doc.sliceString(node.to, line.to);
            if (/^\s*\[[ xX]\]/.test(after)) return;

            const cursorOnMarker = ranges.some(
              (r) => r.from <= node.to && r.to >= node.from
            );
            if (cursorOnMarker) return;

            decorations.push(bulletDeco.range(node.from, node.to));
          },
        });
      }

      return Decoration.set(decorations, true);
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
