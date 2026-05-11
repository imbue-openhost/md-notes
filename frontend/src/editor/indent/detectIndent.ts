// Vim-sleuth-style indent unit detection.
//
// For each non-blank line, record the leading-whitespace length. The most
// common positive diff between consecutive non-blank lines' indents is the
// indent unit. Tab presence at line start votes for tab.

import { Text } from '@codemirror/state';

export type IndentUnit =
  | { kind: 'space'; width: 2 }
  | { kind: 'space'; width: 4 }
  | { kind: 'tab' };

export const DEFAULT_INDENT_UNIT: IndentUnit = { kind: 'space', width: 2 };

// Cap the scan so detection stays O(1) per keystroke on huge docs.
const MAX_LINES_SCAN = 5000;

export function detectIndentUnit(doc: Text | string): IndentUnit {
  const getLine =
    typeof doc === 'string'
      ? ((i: number) => doc.split('\n')[i - 1])
      : ((i: number) => doc.line(i).text);
  const lineCount =
    typeof doc === 'string' ? doc.split('\n').length : doc.lines;

  let tabVotes = 0;
  const spaceDiffVotes = new Map<number, number>();
  let prevSpaceWidth = -1;

  const scan = Math.min(lineCount, MAX_LINES_SCAN);
  for (let i = 1; i <= scan; i++) {
    const text = getLine(i);
    if (!text || !text.trim()) continue;
    const ws = /^[ \t]*/.exec(text)![0];

    if (ws.length === 0) {
      prevSpaceWidth = 0;
      continue;
    }
    if (ws.startsWith('\t')) {
      tabVotes++;
      prevSpaceWidth = -1;
      continue;
    }
    if (prevSpaceWidth >= 0) {
      const diff = ws.length - prevSpaceWidth;
      if (diff > 0) spaceDiffVotes.set(diff, (spaceDiffVotes.get(diff) ?? 0) + 1);
    }
    prevSpaceWidth = ws.length;
  }

  const twoVotes = spaceDiffVotes.get(2) ?? 0;
  const fourVotes = spaceDiffVotes.get(4) ?? 0;
  const maxSpace = Math.max(twoVotes, fourVotes);

  if (tabVotes > maxSpace) return { kind: 'tab' };
  if (fourVotes > twoVotes) return { kind: 'space', width: 4 };
  if (twoVotes > 0) return { kind: 'space', width: 2 };
  return DEFAULT_INDENT_UNIT;
}

// Source string inserted for one indent level.
export function indentUnitString(unit: IndentUnit): string {
  return unit.kind === 'tab' ? '\t' : ' '.repeat(unit.width);
}

// Source chars per level (for dedent matching).
export function indentUnitLength(unit: IndentUnit): number {
  return unit.kind === 'tab' ? 1 : unit.width;
}

// Visual chars rendered per source indent char so that one level always
// occupies 4 visual columns: 2-space → 2, 4-space → 1, tab → 4.
export function indentVisualMultiplier(unit: IndentUnit): number {
  if (unit.kind === 'tab') return 4;
  return 4 / unit.width;
}
