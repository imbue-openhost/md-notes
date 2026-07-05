import { describe, it, expect } from 'vitest';
import { cpRangeToUtf16, splitByRanges } from './search-highlight';

describe('cpRangeToUtf16', () => {
  it('is identity for BMP-only text', () => {
    expect(cpRangeToUtf16('hello world', 6, 11)).toEqual([6, 11]);
  });

  it('accounts for astral chars before the range', () => {
    // '😀' is one codepoint but two UTF-16 units.
    const text = '😀 match';
    expect(cpRangeToUtf16(text, 2, 7)).toEqual([3, 8]);
    expect(text.slice(3, 8)).toBe('match');
  });

  it('handles a range covering astral chars', () => {
    const text = 'a😀b';
    expect(cpRangeToUtf16(text, 0, 3)).toEqual([0, 4]);
  });

  it('clamps a range ending at text end', () => {
    expect(cpRangeToUtf16('abc', 1, 3)).toEqual([1, 3]);
  });
});

describe('splitByRanges', () => {
  it('splits around a single range', () => {
    expect(splitByRanges('foo bar baz', [{ start: 4, end: 7 }])).toEqual([
      { text: 'foo ', match: false },
      { text: 'bar', match: true },
      { text: ' baz', match: false },
    ]);
  });

  it('handles range at start and end', () => {
    expect(splitByRanges('abc', [{ start: 0, end: 3 }])).toEqual([{ text: 'abc', match: true }]);
  });

  it('merges overlapping ranges', () => {
    expect(splitByRanges('abcdef', [{ start: 1, end: 3 }, { start: 2, end: 5 }])).toEqual([
      { text: 'a', match: false },
      { text: 'bcde', match: true },
      { text: 'f', match: false },
    ]);
  });

  it('drops empty ranges and handles no ranges', () => {
    expect(splitByRanges('abc', [{ start: 1, end: 1 }])).toEqual([{ text: 'abc', match: false }]);
    expect(splitByRanges('abc', [])).toEqual([{ text: 'abc', match: false }]);
  });

  it('keeps highlights aligned after an emoji', () => {
    const segs = splitByRanges('😀😀 needle after', [{ start: 3, end: 9 }]);
    expect(segs.find((s) => s.match)?.text).toBe('needle');
  });
});
