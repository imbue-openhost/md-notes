import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { SyntaxNode } from '@lezer/common';

// Shared model for "this position is inside a list item".
// Both the codeBlock plugin's decoration builder and the Enter handler
// consume this so they agree on what column the nested content lives in.
export interface ListContext {
  // True when the position has a ListItem ancestor.
  inListItem: boolean;
  // Column at which the innermost list item's content begins. This is
  // the column of the first non-marker character on the bullet line, e.g.
  // for "- foo" it's 2; for "  - foo" it's 4; for "1.  foo" it's 4.
  // Zero when not in a list item.
  contentColumn: number;
  // Column of the bullet/number marker itself (leading whitespace length
  // on the marker line). Zero when not in a list item.
  listMarkerIndent: number;
  // The innermost ListItem syntax node, or null.
  listItem: SyntaxNode | null;
}

const EMPTY: ListContext = {
  inListItem: false,
  contentColumn: 0,
  listMarkerIndent: 0,
  listItem: null,
};

// Resolve the innermost enclosing ListItem at `pos`, if any.
function findListItem(state: EditorState, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === 'ListItem') return node;
    node = node.parent;
  }
  return null;
}

// Compute the content column for a ListItem from its first line. The
// first line always contains the marker (`-`, `*`, `+`, or `N.`) plus
// the whitespace that follows.
function contentColumnOf(state: EditorState, item: SyntaxNode): {
  contentColumn: number;
  listMarkerIndent: number;
} {
  const line = state.doc.lineAt(item.from);
  const markerIndent = item.from - line.from;
  // Match the marker plus its trailing whitespace.  Bullet lists: -, *, +.
  // Ordered lists: digits followed by . or ).  We require at least one
  // space after the marker (CommonMark).
  const text = line.text.slice(markerIndent);
  const m = /^(?:[-*+]|\d+[.)])([ \t]+)/.exec(text);
  if (!m) {
    // Defensive: if the regex misses, fall back to marker indent + 2.
    return { contentColumn: markerIndent + 2, listMarkerIndent: markerIndent };
  }
  return {
    contentColumn: markerIndent + m[0].length,
    listMarkerIndent: markerIndent,
  };
}

// Public entry point.  Returns a ListContext for `pos`.
export function getListContext(state: EditorState, pos: number): ListContext {
  const item = findListItem(state, pos);
  if (!item) return EMPTY;
  const { contentColumn, listMarkerIndent } = contentColumnOf(state, item);
  return { inListItem: true, contentColumn, listMarkerIndent, listItem: item };
}

// Resolve the innermost FencedCode whose ancestor is a ListItem at `pos`.
// Returns the FencedCode node and the surrounding list context, or null
// when the position isn't inside a code-block-in-list-item.
export function getCodeBlockInListContext(
  state: EditorState,
  pos: number,
): { fencedCode: SyntaxNode; list: ListContext } | null {
  // Side 1 prefers nodes starting at `pos` (e.g. the cursor sitting just
  // before the opening fence) so we don't miss the FencedCode at its own
  // start position.
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  let fencedCode: SyntaxNode | null = null;
  while (node) {
    if (!fencedCode && node.name === 'FencedCode') fencedCode = node;
    if (fencedCode && node.name === 'ListItem') {
      const { contentColumn, listMarkerIndent } = contentColumnOf(state, node);
      return {
        fencedCode,
        list: { inListItem: true, contentColumn, listMarkerIndent, listItem: node },
      };
    }
    node = node.parent;
  }
  // Fallback: side -1 (cursor on a content line ending at `pos`).
  node = syntaxTree(state).resolveInner(pos, -1);
  fencedCode = null;
  while (node) {
    if (!fencedCode && node.name === 'FencedCode') fencedCode = node;
    if (fencedCode && node.name === 'ListItem') {
      const { contentColumn, listMarkerIndent } = contentColumnOf(state, node);
      return {
        fencedCode,
        list: { inListItem: true, contentColumn, listMarkerIndent, listItem: node },
      };
    }
    node = node.parent;
  }
  return null;
}
