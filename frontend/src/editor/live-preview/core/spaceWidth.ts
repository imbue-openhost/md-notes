// Measures the rendered width of a single space character in the editor's
// current font and exposes it via a StateField so both ViewPlugins and
// StateFields (e.g. codeBlock) can consume the value and rebuild when it
// changes.
//
// Why a real measurement instead of `defaultCharacterWidth`: the indent
// math wants the literal width of ' ', not an average glyph. In a
// proportional font those differ by a non-trivial amount, and the indent
// computation is sensitive to it (the bullet would float visibly off the
// expected column).

import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

// Conservative pre-measurement default. Picked to look reasonable for the
// editor's default 16px sans-serif (a space is ~4px there). Used until the
// first real measurement lands; a one-frame settle on initial paint is the
// trade-off for not blocking on layout during state setup.
const DEFAULT_SPACE_PX = 4;

export const setSpaceWidth = StateEffect.define<number>();

export const spaceWidthField = StateField.define<number>({
  create: () => DEFAULT_SPACE_PX,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSpaceWidth)) return effect.value;
    }
    return value;
  },
});

export function spaceWidth(state: EditorState): number {
  return state.field(spaceWidthField, false) ?? DEFAULT_SPACE_PX;
}

function measure(view: EditorView): number {
  const probe = document.createElement('span');
  // white-space:pre keeps the space from collapsing; absolute positioning
  // takes it out of flow so it doesn't disturb layout while we read.
  probe.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;pointer-events:none;';
  probe.textContent = ' ';
  view.contentDOM.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  // jsdom and other non-rendering hosts return 0 — fall back to the
  // default rather than producing a degenerate prefix.
  return w > 0 ? w : DEFAULT_SPACE_PX;
}

export const spaceWidthMeasurer = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.schedule(view);
    }

    update(update: ViewUpdate) {
      // geometryChanged fires on font/size/zoom changes. docChanged isn't
      // relevant — the editor's font doesn't depend on document content.
      if (update.geometryChanged) this.schedule(update.view);
    }

    schedule(view: EditorView) {
      // Defer to a microtask so we don't dispatch synchronously inside
      // construction or an in-flight update — both would re-enter CM6's
      // state machine.
      queueMicrotask(() => {
        const next = measure(view);
        const current = view.state.field(spaceWidthField, false) ?? DEFAULT_SPACE_PX;
        if (Math.abs(next - current) < 0.01) return;
        view.dispatch({ effects: setSpaceWidth.of(next) });
      });
    }
  },
);
