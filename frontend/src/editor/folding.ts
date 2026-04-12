/**
 * Header-based folding for markdown documents.
 *
 * Clicking the fold gutter on a heading collapses everything from the end of
 * the heading line up to (but not including) the next heading of equal or
 * higher level. Nested headings fold independently.
 */

import { syntaxTree } from '@codemirror/language';
import { foldService } from '@codemirror/language';
import { foldGutter } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

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

  tree.iterate({
    from: foldFrom + 1,
    to: docLength,
    enter: (node) => {
      if (node.name.startsWith('ATXHeading')) {
        const otherLevel = parseInt(node.name.replace('ATXHeading', ''), 10);
        if (!isNaN(otherLevel) && otherLevel <= level) {
          // Fold up to the line *before* this heading
          const headingLine = state.doc.lineAt(node.from);
          foldTo = headingLine.from > foldFrom ? headingLine.from - 1 : foldFrom;
          return false; // stop iteration
        }
      }
    },
  });

  // Trim trailing blank lines from the fold range
  while (foldTo > foldFrom) {
    const line = state.doc.lineAt(foldTo);
    if (line.text.trim().length > 0) break;
    foldTo = line.from > foldFrom ? line.from - 1 : foldFrom;
  }

  if (foldTo <= foldFrom) return null;

  return { from: foldFrom, to: foldTo };
});

/**
 * Returns the extensions needed for header-based markdown folding.
 */
export function markdownFolding(): Extension {
  return [markdownFoldService, foldGutter()];
}
