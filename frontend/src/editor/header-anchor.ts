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
import { syntaxTree, ensureSyntaxTree, foldedRanges, unfoldEffect } from '@codemirror/language';
import { UNBOUNDED_PARSE_MS } from './folding';

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
  // Docs parse incrementally and the background parser stops ~100k chars past
  // the viewport, so a partial tree can simply be missing a far-down heading.
  // Force the parse to completion (no-op once parsed; see folding.ts).
  const tree = ensureSyntaxTree(state, state.doc.length, UNBOUNDED_PARSE_MS) ?? syntaxTree(state);
  let found: HeadingTarget | null = null;
  tree.iterate({
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
 * Docs start empty and fill in on first sync — possibly first from a stale
 * IndexedDB copy that predates the linked heading — so this searches on each
 * doc change until the heading appears. Once `synced` resolves the content is
 * authoritative (the handshake's content transaction lands before the promise
 * callbacks run), so a miss then means the heading was renamed or removed:
 * one final search and give up.
 */
class HeaderAnchorPlugin {
  private done = false;
  private pending = false;
  private giveUpOnMiss = false;

  constructor(private view: EditorView, private anchor: string, synced: Promise<void>) {
    synced.catch(() => {}).then(() => {
      this.giveUpOnMiss = true;
      this.search();
    });
  }

  update(u: ViewUpdate) {
    if (!this.done && u.docChanged) this.search();
  }

  destroy() {
    this.done = true;
  }

  private search() {
    if (this.done || this.pending) return;
    this.pending = true;
    // Can't dispatch from inside update(); defer.
    queueMicrotask(() => {
      this.pending = false;
      if (this.done) return;
      const state = this.view.state;
      const h = state.doc.length ? findHeadingBySlug(state, this.anchor) : null;
      if (h) {
        this.done = true;
        jumpToHeading(this.view, h);
        this.view.focus();
      } else if (this.giveUpOnMiss) {
        this.done = true;
      }
    });
  }
}

/** `synced` should resolve once doc content is authoritative; omitted means it already is. */
export function headerAnchorJump(anchor: string, synced?: Promise<void>): Extension {
  return ViewPlugin.define((view) => new HeaderAnchorPlugin(view, anchor, synced ?? Promise.resolve()));
}
