import { EditorView } from '@codemirror/view';

/**
 * Set the ATX heading level of every line touched by the main selection.
 *
 * - Lines already at `level` have their heading removed (tap H2 on an H2 line
 *   to turn it back into a paragraph).
 * - Other lines get their leading `#`s replaced (or inserted) to match.
 * - `level` 0 strips headings.
 */
export function setHeadingLevel(view: EditorView, level: number): boolean {
  if (level < 0 || level > 6) return false;
  const { state } = view;
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from);
  const endLine = state.doc.lineAt(sel.to);

  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = state.doc.line(n);
    const m = line.text.match(/^(#{1,6})(\s+|$)/);
    const current = m ? m[1].length : 0;
    const prefixLen = m ? m[0].length : 0;
    if (current === level || level === 0) {
      if (m) changes.push({ from: line.from, to: line.from + prefixLen, insert: '' });
    } else {
      changes.push({ from: line.from, to: line.from + prefixLen, insert: '#'.repeat(level) + ' ' });
    }
  }

  if (!changes.length) return false;
  view.dispatch({ changes, userEvent: 'input' });
  return true;
}
