/**
 * Consistent caret height on empty lines.
 *
 * CodeMirror measures caret coords on an empty line from the line's <br>
 * filler. In Firefox a <br>'s client rect spans the full line-height
 * (1.75em here), so the drawn caret / vim block cursor is taller on blank
 * lines than on text, where coords come from the glyph box (~1.2em).
 *
 * Fix: decorate each empty line with an invisible zero-width-space span.
 * Coords then come from that span's text-sized rect in every browser, and
 * it inherits whatever font context the line has. Layout is unaffected —
 * CodeMirror still appends the <br>, which keeps the line box full height.
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

class CaretStrutWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.textContent = '​';
    return span;
  }

  override eq(): boolean {
    return true;
  }
}

const strut = Decoration.widget({ widget: new CaretStrutWidget(), side: 1 });

function buildDeco(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.length === 0) {
        builder.add(line.from, line.from, strut);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export function emptyLineCaret() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDeco(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDeco(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
