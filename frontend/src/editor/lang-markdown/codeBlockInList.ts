import { EditorSelection, StateCommand } from '@codemirror/state';
import { SyntaxNode } from '@lezer/common';
import { getCodeBlockInListContext } from '../live-preview/core/listContext';

// Enter handler for fenced code blocks nested inside a list item.
//
// Two cases:
//
// 1) Cursor is on a content line (between the open and close fences). Insert
//    a newline followed by leading whitespace matching the previous content
//    line's indent — so the new line stays inside the parent list item per
//    CommonMark's indent rule. Without this, the default Enter inserts only
//    `\n`, which kicks the new line out of the list and ends the code block.
//
// 2) Cursor is on the closing fence line (or at the end of it). Exit the
//    code block and open a new bullet at the parent list's indent level —
//    i.e. continue the list. Cursor lands after the new marker.
//
// Returns false in any other case so other Enter handlers (markdown's
// continueMarkup, default newline) can run.
export const insertNewlineInListCodeBlock: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  if (!sel.empty) return false;

  const ctx = getCodeBlockInListContext(state, sel.from);
  if (!ctx) return false;

  const { fencedCode, list } = ctx;

  // Find the opening and closing fence positions.  CodeMark children
  // bracket the FencedCode node; CodeText is the body.
  let openFence: SyntaxNode | null = null;
  let closeFence: SyntaxNode | null = null;
  let cur = fencedCode.firstChild;
  while (cur) {
    if (cur.name === 'CodeMark') {
      if (!openFence) openFence = cur;
      else closeFence = cur;
    }
    cur = cur.nextSibling;
  }
  if (!openFence) return false;

  const doc = state.doc;
  const openFenceLine = doc.lineAt(openFence.from);
  const closeFenceLine = closeFence ? doc.lineAt(closeFence.from) : null;
  const cursorLine = doc.lineAt(sel.from);

  // Case 2: cursor is on the closing fence line. End the code block, open
  // a new bullet at the list-marker column. We delete from cursor to the
  // line end (any trailing chars on the close-fence line shouldn't survive
  // the split), then insert "\n" + listMarkerIndent spaces + "- ".
  if (closeFenceLine && cursorLine.from === closeFenceLine.from) {
    const indent = ' '.repeat(list.listMarkerIndent);
    const insert = `\n${indent}- `;
    dispatch(
      state.update({
        changes: { from: sel.from, to: cursorLine.to, insert },
        selection: EditorSelection.cursor(sel.from + insert.length),
        scrollIntoView: true,
        userEvent: 'input',
      }),
    );
    return true;
  }

  // Case 1: cursor on a content line.  Insert newline + matching leading
  // whitespace.  Leading whitespace is taken from the cursor's own line
  // (so the new line continues the same indent the user is currently on).
  // Defensive guard — only act if we're below the open fence.
  if (cursorLine.number <= openFenceLine.number) return false;
  if (closeFenceLine && cursorLine.number >= closeFenceLine.number) return false;

  const lineText = cursorLine.text;
  const leading = /^[ \t]*/.exec(lineText)![0];
  // The continuation must satisfy CommonMark's indent rule for the parent
  // list, i.e. >= list.contentColumn.  If the current line's leading WS is
  // already at or past the content column, mirror it; otherwise fall back
  // to the content column so the next line stays inside the list item.
  const insertIndent =
    leading.length >= list.contentColumn
      ? leading
      : ' '.repeat(list.contentColumn);
  const insert = `\n${insertIndent}`;
  dispatch(
    state.update({
      changes: { from: sel.from, to: sel.to, insert },
      selection: EditorSelection.cursor(sel.from + insert.length),
      scrollIntoView: true,
      userEvent: 'input',
    }),
  );
  return true;
};
