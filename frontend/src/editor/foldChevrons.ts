/**
 * Inline fold chevrons on heading lines (Obsidian-style) — no gutter column;
 * the chevron renders in the line's left content margin. Clicking it toggles
 * the fold.
 *
 * Two reveal modes:
 * - 'hover' (desktop): every foldable heading gets a chevron widget; CSS
 *   keeps it invisible until the line is hovered or the section is folded.
 * - 'cursor' (mobile, where hover doesn't exist): a chevron is only added
 *   when the cursor is on the heading line, or when the section is folded
 *   (so it can always be unfolded).
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

export type ChevronReveal = 'hover' | 'cursor';

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

// Right-pointing chevron; CSS rotates it 90° when the section is unfolded.
const CHEVRON_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polyline points="9 6 15 12 9 18"/></svg>';

class FoldChevronWidget extends WidgetType {
  constructor(readonly folded: boolean, readonly lineFrom: number) {
    super();
  }

  override eq(other: FoldChevronWidget): boolean {
    return other.folded === this.folded && other.lineFrom === this.lineFrom;
  }

  override toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-fold-chevron';
    span.dataset.folded = this.folded ? 'true' : 'false';
    span.innerHTML = CHEVRON_SVG;
    span.setAttribute('aria-hidden', 'true');
    // preventDefault on pointerdown so the tap/click neither moves the cursor
    // nor dismisses the virtual keyboard.
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

function buildDecorations(view: EditorView, reveal: ChevronReveal): DecorationSet {
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
        const wanted =
          folded ||
          ((reveal === 'hover' || line.number === cursorLine) &&
            foldable(state, line.from, line.to));
        if (wanted) {
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

export function foldChevrons(reveal: ChevronReveal) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, reveal);
      }

      update(update: ViewUpdate) {
        const foldChanged = update.transactions.some((tr) =>
          tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
        );
        const cursorMoved = reveal === 'cursor' && update.selectionSet;
        if (update.docChanged || cursorMoved || update.viewportChanged || foldChanged) {
          this.decorations = buildDecorations(update.view, reveal);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
