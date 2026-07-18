import { EditorView } from '@codemirror/view';

/**
 * Line range from a parsed `:` ex command. `start` and `end` are 0-based
 * CodeMirror line numbers (matching `params.selectionLine` /
 * `selectionLineEnd` from @replit/codemirror-vim).
 */
export interface ActionLineRange {
  start: number;
  end?: number;
}

/**
 * Toggle bullet/task state across the current selection.
 *
 * Scans every line in the selection that starts with a bullet (`-`, `*`, `+`,
 * or numbered like `1.` / `1)`). Each matched line has one of three statuses
 * that cycle:
 *
 *   bullet (`- foo`) → unchecked (`- [ ] foo`) → checked (`- [x] foo`) → bullet
 *
 * If every matched line shares a status, each advances one step. If the
 * selection mixes statuses, only the lines at the lowest present status
 * (bullet < unchecked < checked) advance; the rest are left untouched.
 *
 * Lines that aren't list items at all become `- [ ] ` tasks (indent
 * preserved) when the selection contains no bullet lines.
 *
 * With no selection (cursor on a single line) this reduces to the
 * single-line toggle behaviour.
 *
 * When invoked from a vim visual-mode mapping, codemirror-vim exits visual
 * mode (clearing the CM selection) before the ex handler runs, so the line
 * range is passed in via `range` instead of read from `state.selection`.
 */
export function toggleTaskAtSelection(view: EditorView, range?: ActionLineRange): boolean {
  const { state } = view;

  let startLineNum: number;
  let endLineNum: number;
  if (range) {
    // 0-based → 1-based for state.doc.line()
    startLineNum = range.start + 1;
    endLineNum = (range.end ?? range.start) + 1;
  } else {
    const sel = state.selection.main;
    const startLine = state.doc.lineAt(sel.from);
    const endLine = state.doc.lineAt(sel.to);
    startLineNum = startLine.number;
    // Visual-line selections often end at the start of the line *after* the
    // last visually-selected line. Don't treat that trailing line as selected.
    endLineNum =
      sel.to > sel.from && sel.to === endLine.from && endLine.number > startLine.number
        ? endLine.number - 1
        : endLine.number;
  }

  type Item = {
    prefixEnd: number;
    // markerEnd spans "[x]" plus its trailing whitespace, for clean removal.
    marker?: { from: number; to: number; markerEnd: number; checked: boolean };
  };
  const items: Item[] = [];
  for (let n = startLineNum; n <= endLineNum; n++) {
    const line = state.doc.line(n);
    const text = state.doc.sliceString(line.from, line.to);
    const m = text.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(\[([ xX])\]\s+)?/);
    if (!m) continue;
    const prefixEnd = line.from + m[1].length;
    if (!m[2]) {
      items.push({ prefixEnd });
    } else {
      items.push({
        prefixEnd,
        marker: {
          from: prefixEnd,
          to: prefixEnd + 3,
          markerEnd: prefixEnd + m[2].length,
          checked: m[3] !== ' ',
        },
      });
    }
  }

  const changes: { from: number; to: number; insert: string }[] = [];

  if (items.length === 0) {
    // No list items in range: turn every line into an unchecked task.
    for (let n = startLineNum; n <= endLineNum; n++) {
      const line = state.doc.line(n);
      const text = state.doc.sliceString(line.from, line.to);
      const indent = text.match(/^\s*/)![0].length;
      changes.push({ from: line.from + indent, to: line.from + indent, insert: '- [ ] ' });
    }
    view.dispatch({ changes });
    return true;
  }

  // 0 = bullet, 1 = unchecked, 2 = checked
  const statusOf = (it: Item) => (!it.marker ? 0 : it.marker.checked ? 2 : 1);
  const statuses = items.map(statusOf);
  const minStatus = Math.min(...statuses);
  const allSame = statuses.every((s) => s === minStatus);

  for (const it of items) {
    if (!allSame && statusOf(it) !== minStatus) continue;
    if (!it.marker) {
      changes.push({ from: it.prefixEnd, to: it.prefixEnd, insert: '[ ] ' });
    } else if (!it.marker.checked) {
      changes.push({ from: it.marker.from, to: it.marker.to, insert: '[x]' });
    } else {
      // Checked wraps back around to a plain bullet.
      changes.push({ from: it.marker.from, to: it.marker.markerEnd, insert: '' });
    }
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
}
