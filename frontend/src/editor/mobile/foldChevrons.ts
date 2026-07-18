/**
 * Inline fold chevrons for the mobile editor (Obsidian-mobile-style).
 *
 * Instead of a persistent fold gutter column, a chevron appears in the left
 * content margin of a heading line only when the cursor is on that line, or
 * when the section is folded (so it can always be unfolded). Tapping it
 * toggles the fold.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { Range } from '@codemirror/state';
import { foldable, foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

function foldedRangeAt(state: EditorState, lineTo: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(state).between(lineTo, lineTo, (from, to) => {
    if (from === lineTo) found = { from, to };
  });
  return found;
}

function toggleFoldAtLine(view: EditorView, lineFrom: number) {
  const line = view.state.doc.lineAt(lineFrom);
  const existing = foldedRangeAt(view.state, line.to);
  if (existing) {
    view.dispatch({ effects: unfoldEffect.of(existing) });
  } else {
    const range = foldable(view.state, line.from, line.to);
    if (range) view.dispatch({ effects: foldEffect.of(range) });
  }
}

class FoldChevronWidget extends WidgetType {
  constructor(readonly folded: boolean, readonly lineFrom: number) {
    super();
  }

  override eq(other: FoldChevronWidget): boolean {
    return other.folded === this.folded && other.lineFrom === this.lineFrom;
  }

  override toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-mobile-fold-chevron';
    span.dataset.folded = this.folded ? 'true' : 'false';
    span.textContent = this.folded ? '▸' : '▾';
    span.setAttribute('aria-hidden', 'true');
    // preventDefault on pointerdown so the tap neither moves the cursor nor
    // dismisses the virtual keyboard.
    span.addEventListener('pointerdown', (e) => e.preventDefault());
    span.addEventListener('mousedown', (e) => e.preventDefault());
    span.addEventListener('click', (e) => {
      e.preventDefault();
      toggleFoldAtLine(view, this.lineFrom);
    });
    return span;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;
  const decos: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (/^#{1,6}\s/.test(line.text)) {
        const folded = !!foldedRangeAt(state, line.to);
        // The foldable() check confirms this is a real heading (not e.g. a
        // "# comment" inside a code fence) with content to fold.
        if (folded || (line.number === cursorLine && foldable(state, line.from, line.to))) {
          decos.push(
            Decoration.widget({
              widget: new FoldChevronWidget(folded, line.from),
              side: -1,
            }).range(line.from),
          );
        }
      }
      pos = line.to + 1;
    }
  }

  return Decoration.set(decos);
}

const foldChevronPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      const foldChanged = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
      );
      if (update.docChanged || update.selectionSet || update.viewportChanged || foldChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function mobileFoldChevrons() {
  return foldChevronPlugin;
}
