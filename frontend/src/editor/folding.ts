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
import { Prec, type Extension } from '@codemirror/state';

/**
 * Fold service that defines ranges based on ATXHeading nodes.
 */
const markdownFoldService = foldService.of((state, lineStart, lineEnd) => {
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
