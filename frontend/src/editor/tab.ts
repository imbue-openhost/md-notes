/**
 * Tab / Shift-Tab handling for the editor.
 *
 * Goal: Tab and Shift-Tab must always be consumed by the editor (never
 * fall through to the browser, which would shift focus). Behaviour:
 *
 *   - On a list line, indent/dedent the line(s) in the selection by
 *     one level (2 spaces).
 *   - With a non-empty selection (visual mode or otherwise), Tab indents
 *     every selected line, Shift-Tab dedents.
 *   - With an empty selection on a non-list line, Tab inserts
 *     `state.tabSize` spaces. Shift-Tab dedents the current line if it
 *     has leading whitespace; otherwise no-op (but still consumes the
 *     event).
 *
 * The handlers always return true so CM6 calls preventDefault and the
 * browser doesn't capture the Tab.
 */

import { EditorView } from '@codemirror/view';
import { indentMore, indentLess } from './commands/commands';

const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s/;

interface LineRange {
  startLineNum: number;
  endLineNum: number;
}

function selectedLineRange(view: EditorView): LineRange {
  const { state } = view;
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from);
  const endLine = state.doc.lineAt(sel.to);
  // Visual-line selections often end at the start of the line *after* the
  // last visually-selected line. Don't include that trailing line.
  const endLineNum =
    sel.to > sel.from && sel.to === endLine.from && endLine.number > startLine.number
      ? endLine.number - 1
      : endLine.number;
  return { startLineNum: startLine.number, endLineNum };
}

/**
 * Returns true if the selection covers any list lines, in which case
 * we handle Tab/Shift-Tab as list indent/dedent.
 */
function hasListLineInRange(view: EditorView, range: LineRange): boolean {
  const { state } = view;
  for (let n = range.startLineNum; n <= range.endLineNum; n++) {
    if (LIST_LINE_RE.test(state.doc.line(n).text)) return true;
  }
  return false;
}

/**
 * Indent every list line in the selection by 2 spaces. Non-list lines
 * are skipped.
 */
function indentListLinesOnly(view: EditorView, range: LineRange): void {
  const { state } = view;
  const changes: { from: number; insert: string }[] = [];
  for (let n = range.startLineNum; n <= range.endLineNum; n++) {
    const line = state.doc.line(n);
    if (LIST_LINE_RE.test(line.text)) {
      changes.push({ from: line.from, insert: '  ' });
    }
  }
  if (changes.length > 0) view.dispatch({ changes });
}

/**
 * Dedent every list line in the selection by up to 2 leading whitespace
 * chars. Non-list lines and lines without leading whitespace are skipped.
 */
function dedentListLinesOnly(view: EditorView, range: LineRange): void {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  for (let n = range.startLineNum; n <= range.endLineNum; n++) {
    const line = state.doc.line(n);
    if (!LIST_LINE_RE.test(line.text)) continue;
    const ws = /^[ \t]*/.exec(line.text)![0];
    if (ws.length === 0) continue;
    const remove = Math.min(2, ws.length);
    changes.push({ from: line.from, to: line.from + remove, insert: '' });
  }
  if (changes.length > 0) view.dispatch({ changes });
}

/**
 * Tab handler — always consumes the event.
 *
 *   1. If the selection covers any list line(s), indent the list line(s).
 *   2. Else if the selection is non-empty (visual mode or a selected
 *      block), use indentMore on the whole selection.
 *   3. Else (cursor on a non-list line), insert `state.tabSize` spaces.
 */
export function handleTab(view: EditorView): boolean {
  if (view.state.readOnly) return true;

  const range = selectedLineRange(view);
  if (hasListLineInRange(view, range)) {
    indentListLinesOnly(view, range);
    return true;
  }

  const sel = view.state.selection.main;
  if (!sel.empty) {
    indentMore(view);
    return true;
  }

  const insert = ' '.repeat(view.state.tabSize);
  view.dispatch(
    view.state.update(view.state.replaceSelection(insert), {
      scrollIntoView: true,
      userEvent: 'input',
    }),
  );
  return true;
}

/**
 * Shift-Tab handler — always consumes the event.
 *
 *   1. If the selection covers any list line(s), dedent them.
 *   2. Else dedent every selected line via indentLess (also handles
 *      a single-line cursor with leading whitespace; no-op without).
 */
export function handleShiftTab(view: EditorView): boolean {
  if (view.state.readOnly) return true;

  const range = selectedLineRange(view);
  if (hasListLineInRange(view, range)) {
    dedentListLinesOnly(view, range);
    return true;
  }
  indentLess(view);
  return true;
}
