/**
 * Header-based folding for markdown documents.
 *
 * Clicking the fold gutter on a heading collapses everything from the end of
 * the heading line up to (but not including) the next heading of equal or
 * higher level. Any blank lines preceding that next heading are absorbed into
 * the fold so collapsed sections stack with consistent spacing regardless of
 * how the source document is whitespaced. Nested headings fold independently.
 */

import { syntaxTree } from '@codemirror/language';
import { foldService } from '@codemirror/language';
import { foldGutter } from '@codemirror/language';
import { foldable } from '@codemirror/language';
import { foldEffect } from '@codemirror/language';
import { Prec, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Fold service that defines ranges based on ATXHeading nodes. Exported so unit
 * tests can install just the service (without the DOM-dependent fold gutter).
 */
export const markdownFoldService = foldService.of((state, lineStart, lineEnd) => {
  const tree = syntaxTree(state);
  let headingName = '';
  let headingFrom = 0;
  let headingTo = 0;
  let found = false;

  // Find heading node on this line
  tree.iterate({
    from: lineStart,
    to: lineEnd,
    enter: (node) => {
      if (node.name.startsWith('ATXHeading') && !found) {
        headingName = node.name;
        headingFrom = node.from;
        headingTo = node.to;
        found = true;
      }
    },
  });

  if (!found) return null;

  // Extract heading level (ATXHeading1 → 1, ATXHeading2 → 2, etc.)
  const level = parseInt(headingName.replace('ATXHeading', ''), 10);
  if (isNaN(level)) return null;

  // Fold from end of heading line to just before the next heading of equal
  // or higher level.
  const foldFrom = state.doc.lineAt(headingTo).to;
  const docLength = state.doc.length;

  if (foldFrom >= docLength) return null;

  let foldTo = docLength;

  // Use a cursor to walk the tree so we can break on first match.
  // tree.iterate's `return false` only skips children, not siblings.
  const cursor = tree.cursor();
  cursor.moveTo(foldFrom + 1);
  // Walk forward through all nodes after foldFrom
  do {
    if (cursor.name.startsWith('ATXHeading') && cursor.from > foldFrom) {
      const otherLevel = parseInt(cursor.name.replace('ATXHeading', ''), 10);
      if (!isNaN(otherLevel) && otherLevel <= level) {
        const headingLine = state.doc.lineAt(cursor.from);
        foldTo = headingLine.from > foldFrom ? headingLine.from - 1 : foldFrom;
        break;
      }
    }
  } while (cursor.next());

  if (foldTo <= foldFrom) return null;

  return { from: foldFrom, to: foldTo };
});

/**
 * Returns the extensions needed for header-based markdown folding.
 *
 * Our fold service is registered with `Prec.high` so it runs before the
 * `headerIndent` fold service that `@codemirror/lang-markdown` installs by
 * default — that built-in service ends folds at the last non-blank line, which
 * leaves the inter-section whitespace visible and conflicts with our range.
 */
export function markdownFolding(): Extension {
  return [Prec.high(markdownFoldService), foldGutter()];
}

/**
 * Fold every foldable line, including nested ones. The built-in `foldAll`
 * skips past each discovered range, so subheadings inside an outer section
 * never get folded — toggling the outer section open then reveals expanded
 * subsections. We iterate every line so nested folds are registered too.
 */
export function foldAllRecursive(view: EditorView): boolean {
  const { state } = view;
  const effects = [];
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const range = foldable(state, line.from, line.to);
    if (range) effects.push(foldEffect.of(range));
  }
  if (!effects.length) return false;
  view.dispatch({ effects });
  return true;
}
