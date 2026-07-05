/**
 * Helpers for rendering search-hit highlight ranges.
 *
 * The backend reports ranges as Unicode codepoint offsets (Python string
 * indices); JS strings are UTF-16, so any astral char (e.g. emoji) before a
 * match would desync the highlight without conversion.
 */

import type { MatchRange } from '../api/types';

export interface Segment {
  text: string;
  match: boolean;
}

/** Convert a codepoint range to UTF-16 offsets into `text`. */
export function cpRangeToUtf16(text: string, cpStart: number, cpEnd: number): [number, number] {
  let cp = 0;
  let u16 = 0;
  let start = -1;
  for (const ch of text) {
    if (cp === cpStart) start = u16;
    if (cp === cpEnd) return [start === -1 ? u16 : start, u16];
    cp++;
    u16 += ch.length;
  }
  if (cp === cpStart) start = u16;
  return [start === -1 ? u16 : start, u16];
}

/** Split `text` into ordered segments, marking those covered by `ranges` (codepoint offsets). */
export function splitByRanges(text: string, ranges: MatchRange[]): Segment[] {
  const utf16 = ranges
    .map((r) => cpRangeToUtf16(text, r.start, r.end))
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  // Merge overlapping/adjacent ranges.
  const merged: [number, number][] = [];
  for (const [s, e] of utf16) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  const segments: Segment[] = [];
  let pos = 0;
  for (const [s, e] of merged) {
    if (s > pos) segments.push({ text: text.slice(pos, s), match: false });
    segments.push({ text: text.slice(s, e), match: true });
    pos = e;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), match: false });
  return segments;
}
