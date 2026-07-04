// Normalise indentation of pasted (or vim-yanked) text so it matches
// the target document's detected indent unit.

import {
  type ChangeSpec,
  EditorSelection,
  EditorState,
  type Extension,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import {
  detectIndentUnit,
  type IndentUnit,
  indentUnitLength,
  indentUnitString,
} from './detectIndent';
import { indentUnitOf } from './indentUnitField';

function unitEq(a: IndentUnit, b: IndentUnit): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'tab') return true;
  return (a as { width: number }).width === (b as { width: number }).width;
}

// Detect indent unit from a pasted snippet.  Returns null when the text
// has no indent transitions (e.g. a single-depth list or a flat block),
// because we can't confidently identify the source unit in that case.
export function detectPastedIndent(text: string): IndentUnit | null {
  const lines = text.split('\n');
  let prevIndent = -1;
  let hasTransition = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = /^[ \t]*/.exec(line)![0].length;
    if (prevIndent >= 0 && indent !== prevIndent) {
      hasTransition = true;
      break;
    }
    prevIndent = indent;
  }
  if (!hasTransition) return null;
  return detectIndentUnit(text);
}

// Re-indent every line of `text`: convert leading whitespace from
// `from` units to `to` units.
export function reindentText(
  text: string,
  from: IndentUnit,
  to: IndentUnit,
): string {
  const fromLen = indentUnitLength(from);
  const toStr = indentUnitString(to);
  return text
    .split('\n')
    .map((line) => {
      const m = /^([ \t]*)(.*)$/.exec(line)!;
      const ws = m[1];
      const rest = m[2];
      if (!ws) return line;
      const levels =
        from.kind === 'tab'
          ? (ws.match(/\t/g) || []).length
          : Math.round(ws.length / fromLen);
      return toStr.repeat(levels) + rest;
    })
    .join('\n');
}

export function pasteIndentNormalization(): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;

    let hasMultiLine = false;
    tr.changes.iterChanges((_, _2, _3, _4, inserted) => {
      if (inserted.lines > 1) hasMultiLine = true;
    });
    if (!hasMultiLine) return tr;

    const targetUnit = indentUnitOf(tr.startState);

    let needsAdjust = false;
    let totalDelta = 0;
    const adjusted: { from: number; to: number; insert: string }[] = [];
    const insertDeltas: { fromB: number; origLen: number; delta: number }[] = [];

    tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
      const text = inserted.toString();
      if (inserted.lines <= 1) {
        adjusted.push({ from: fromA, to: toA, insert: text });
        insertDeltas.push({ fromB, origLen: text.length, delta: 0 });
        return;
      }
      const sourceUnit = detectPastedIndent(text);
      if (!sourceUnit || unitEq(sourceUnit, targetUnit)) {
        adjusted.push({ from: fromA, to: toA, insert: text });
        insertDeltas.push({ fromB, origLen: text.length, delta: 0 });
        return;
      }
      const adj = reindentText(text, sourceUnit, targetUnit);
      const d = adj.length - text.length;
      if (d !== 0) needsAdjust = true;
      totalDelta += d;
      adjusted.push({ from: fromA, to: toA, insert: adj });
      insertDeltas.push({ fromB, origLen: text.length, delta: d });
    });

    if (!needsAdjust) return tr;

    const adjDocLen = tr.newDoc.length + totalDelta;
    const remap = (pos: number) => {
      let cum = 0;
      for (const ins of insertDeltas) {
        if (pos <= ins.fromB + cum) return pos + cum;
        const origEnd = ins.fromB + cum + ins.origLen;
        if (pos >= origEnd) {
          cum += ins.delta;
          continue;
        }
        return Math.min(pos + cum + ins.delta, adjDocLen);
      }
      return Math.min(pos + cum, adjDocLen);
    };

    const sel = EditorSelection.create(
      tr.newSelection.ranges.map((r) =>
        EditorSelection.range(remap(r.anchor), remap(r.head)),
      ),
      tr.newSelection.mainIndex,
    );

    const ue = tr.annotation(Transaction.userEvent);
    const spec: TransactionSpec = {
      changes: adjusted as ChangeSpec,
      selection: sel,
      scrollIntoView: tr.scrollIntoView,
      userEvent: ue,
    };
    return spec;
  });
}
