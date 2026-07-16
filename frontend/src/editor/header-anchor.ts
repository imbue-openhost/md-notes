/**
 * Jump-to-header support for share URLs (/share/<uuid>#<slug>).
 *
 * Slugs are GitHub-style: heading text lowercased, punctuation dropped,
 * spaces replaced with hyphens. The URL hash is matched against every
 * ATX heading in document order; the first match wins. No match (or a
 * renamed heading) just loads the page normally.
 */

import { ViewPlugin, EditorView, type ViewUpdate } from '@codemirror/view';
import { type Extension, type EditorState, type StateEffect } from '@codemirror/state';
import { syntaxTree, syntaxTreeAvailable, foldedRanges, unfoldEffect } from '@codemirror/language';

export interface HeadingTarget {
  lineFrom: number;
  lineTo: number;
}

/** GitHub-style slug. Also accepts raw heading text (with or without `#` marks) as input. */
export function slugifyHeader(text: string): string {
  return text
    .replace(/^#+[ \t]*/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** First ATX heading whose slug matches `anchor` (itself slugified, so raw text works too). */
export function findHeadingBySlug(state: EditorState, anchor: string): HeadingTarget | null {
  const target = slugifyHeader(anchor);
  if (!target) return null;
  let found: HeadingTarget | null = null;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (found) return false;
      if (!/^ATXHeading\d$/.test(node.name)) return;
      const line = state.doc.lineAt(node.from);
      if (slugifyHeader(state.doc.sliceString(line.from, line.to)) === target) {
        found = { lineFrom: line.from, lineTo: line.to };
      }
      return false;
    },
  });
  return found;
}

/**
 * Unfold everything hiding the heading (ancestor folds and the heading's own
 * section), put the cursor on it, and scroll it to the top of the view.
 * Folds elsewhere in the doc are left alone.
 */
export function jumpToHeading(view: EditorView, heading: HeadingTarget): void {
  const effects: StateEffect<unknown>[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    // Ancestor folds span the heading line; the heading's own fold starts at
    // its line end. Folds entirely before or after the line don't overlap.
    if (to >= heading.lineFrom && from <= heading.lineTo) {
      effects.push(unfoldEffect.of({ from, to }));
    }
  });
  effects.push(EditorView.scrollIntoView(heading.lineFrom, { y: 'start', yMargin: 8 }));
  view.dispatch({ selection: { anchor: heading.lineFrom }, effects });
}

/**
 * Docs start empty and fill in on first sync, then parse incrementally, so
 * this retries on every update until the heading appears or the whole doc has
 * parsed without a match.
 */
class HeaderAnchorPlugin {
  private done = false;

  constructor(private view: EditorView, private anchor: string) {}

  update(u: ViewUpdate) {
    if (this.done || u.state.doc.length === 0) return;
    if (findHeadingBySlug(u.state, this.anchor)) {
      this.done = true;
      // Can't dispatch from inside update(); re-resolve in the microtask in
      // case positions shifted.
      queueMicrotask(() => {
        const h = findHeadingBySlug(this.view.state, this.anchor);
        if (h) {
          jumpToHeading(this.view, h);
          this.view.focus();
        }
      });
    } else if (syntaxTreeAvailable(u.state, u.state.doc.length)) {
      this.done = true;
    }
  }
}

export function headerAnchorJump(anchor: string): Extension {
  return ViewPlugin.define((view) => new HeaderAnchorPlugin(view, anchor));
}
