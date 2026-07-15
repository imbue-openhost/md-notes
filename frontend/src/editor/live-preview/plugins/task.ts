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
import { listLineLayout } from '../core/listLineLayout';
import { spaceWidthField } from '../core/spaceWidth';

// Visual pixel width of the rendered checkbox widget plus its
// margin-right. Used for the task line's hanging-indent math so wrapped
// task text lines up under the task's text column rather than under the
// checkbox. The theme sizes the box at 14px plus a 0.4em right margin
// (~6.4px at 16px). One value is fine — checkboxes don't scale with the
// editor font.
const CHECKBOX_PX = 22;

// The checkbox is a styled <span>, not an <input>: password-manager
// extensions (e.g. Apple's iCloud Passwords) scan every input that
// appears in the DOM and could steal focus to their native app. For the
// same reason eq() must not depend on document position — otherwise any
// edit above a task would recreate the DOM node, and the position is
// resolved at click time instead.
class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }

  toDOM(view: EditorView) {
    const box = document.createElement('span');
    box.className = 'cm-task-checkbox';
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.addEventListener('click', () => toggleTaskAtWidget(view, box));
    return box;
  }

  ignoreEvent() {
    return true;
  }
}

function toggleTaskAtWidget(view: EditorView, dom: HTMLElement) {
  const line = view.state.doc.lineAt(view.posAtDOM(dom));
  const match = line.text.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/);
  if (!match) return;
  const from = line.from + match[0].length - 3;
  const insert = match[1] === ' ' ? '[x]' : '[ ]';
  view.dispatch({ changes: { from, to: from + 3, insert } });
}

/**
 * GFM task list rendering. Reuses the shared list-line layout (so indent,
 * line `text-indent`/`padding-inline-start`, and depth class match a
 * non-task bullet at the same nesting depth) and overlays a checkbox
 * widget that replaces the `- [ ]` marker run.
 */
export const taskListPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
      const built = this.build(view);
      this.decorations = built.decorations;
      this.atomic = built.atomic;
    }

    update(update: ViewUpdate) {
      const spaceWidthChanged =
        update.startState.field(spaceWidthField, false) !==
        update.state.field(spaceWidthField, false);
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        spaceWidthChanged
      ) {
        const built = this.build(update.view);
        this.decorations = built.decorations;
        this.atomic = built.atomic;
      }
    }

    build(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
      const decorations: Range<Decoration>[] = [];
      // Only replace widgets are atomic. The cm-task-checked mark covers
      // the whole text region of a checked task line — letting it into
      // atomicRanges would cause Backspace to delete the entire line text.
      const atomicDecorations: Range<Decoration>[] = [];
      const { state } = view;
      const ranges = state.selection.ranges;
      const tree = syntaxTree(state);

      for (const { from, to } of view.visibleRanges) {
        let listDepth = 0;
        tree.iterate({
          from,
          to,
          enter: (node) => {
            if (node.name === 'BulletList' || node.name === 'OrderedList') {
              listDepth++;
              return;
            }
            if (node.name !== 'TaskMarker') return;

            const text = state.doc.sliceString(node.from, node.to);
            const checked = /^\[[xX]\]$/.test(text);

            const line = state.doc.lineAt(node.from);
            const prefix = line.text.slice(0, node.from - line.from);
            // Marker run on the source line: leading WS, the list marker
            // (`-`/`*`/`+`/`N.`), and the whitespace before `[ ]`.
            const bulletMatch = prefix.match(/^(\s*)([-*+]|\d+[.)])(\s+)$/);
            if (!bulletMatch) return;

            const indentLen = bulletMatch[1].length;
            const markLen = bulletMatch[2].length;
            const listMarkFrom = line.from + indentLen;
            const listMarkTo = listMarkFrom + markLen;

            const layout = listLineLayout(
              state,
              line,
              { from: listMarkFrom, to: listMarkTo },
              listDepth,
              CHECKBOX_PX,
            );
            if (layout.indentDecoration) {
              decorations.push(layout.indentDecoration);
              atomicDecorations.push(layout.indentDecoration);
            }
            decorations.push(layout.lineDecoration);

            // Checkbox replaces from the bullet through `[ ]`. We don't
            // include the trailing space after the checkbox so the cursor
            // can land between the checkbox and the task text.
            const replaceFrom = listMarkFrom;
            const replaceTo = node.to;

            const cursorOnMarker = ranges.some(
              (r) => r.from <= replaceTo && r.to >= replaceFrom,
            );

            if (!cursorOnMarker) {
              const checkboxDeco = Decoration.replace({
                widget: new CheckboxWidget(checked),
              }).range(replaceFrom, replaceTo);
              decorations.push(checkboxDeco);
              atomicDecorations.push(checkboxDeco);
            }

            if (checked) {
              const after = state.doc.sliceString(node.to, line.to);
              const leadingWs = after.match(/^\s*/)?.[0].length ?? 0;
              const markFrom = node.to + leadingWs;
              if (markFrom < line.to) {
                decorations.push(
                  Decoration.mark({ class: 'cm-task-checked' }).range(markFrom, line.to),
                );
              }
            }
          },
          leave: (node) => {
            if (node.name === 'BulletList' || node.name === 'OrderedList') listDepth--;
          },
        });
      }

      return {
        decorations: Decoration.set(decorations.sort((a, b) => a.from - b.from), true),
        atomic: Decoration.set(atomicDecorations.sort((a, b) => a.from - b.from), true),
      };
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => {
        return view.plugin(plugin)?.atomic || Decoration.none;
      }),
  },
);
