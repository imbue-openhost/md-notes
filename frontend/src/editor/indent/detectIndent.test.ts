import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import {
  detectIndentUnit,
  indentUnitString,
  indentUnitLength,
  indentVisualMultiplier,
} from './detectIndent';

const fromStr = (s: string) => Text.of(s.split('\n'));

describe('detectIndentUnit', () => {
  it('defaults to 2-space on empty doc', () => {
    expect(detectIndentUnit(fromStr(''))).toEqual({ kind: 'space', width: 2 });
  });

  it('defaults to 2-space when no indentation present', () => {
    expect(detectIndentUnit(fromStr('hello\nworld\nfoo'))).toEqual({ kind: 'space', width: 2 });
  });

  it('detects 2-space indent', () => {
    const doc = '- a\n  - b\n  - c\n    - d';
    expect(detectIndentUnit(fromStr(doc))).toEqual({ kind: 'space', width: 2 });
  });

  it('detects 4-space indent', () => {
    const doc = '- a\n    - b\n    - c\n        - d';
    expect(detectIndentUnit(fromStr(doc))).toEqual({ kind: 'space', width: 4 });
  });

  it('detects tab indent', () => {
    const doc = '- a\n\t- b\n\t\t- c';
    expect(detectIndentUnit(fromStr(doc))).toEqual({ kind: 'tab' });
  });

  it('picks the most common positive diff when mixed', () => {
    // Three 2-step increases, one 4-step. 2-space wins.
    const doc = 'a\n  b\n    c\n      d\n        e\n            f';
    expect(detectIndentUnit(fromStr(doc))).toEqual({ kind: 'space', width: 2 });
  });

  it('accepts plain string input', () => {
    expect(detectIndentUnit('- a\n    - b\n    - c')).toEqual({ kind: 'space', width: 4 });
  });

  it('ignores blank lines when computing diffs', () => {
    const doc = '- a\n\n    - b\n\n    - c';
    expect(detectIndentUnit(fromStr(doc))).toEqual({ kind: 'space', width: 4 });
  });
});

describe('indentUnitString', () => {
  it('returns spaces for space units', () => {
    expect(indentUnitString({ kind: 'space', width: 2 })).toBe('  ');
    expect(indentUnitString({ kind: 'space', width: 4 })).toBe('    ');
  });
  it('returns tab for tab unit', () => {
    expect(indentUnitString({ kind: 'tab' })).toBe('\t');
  });
});

describe('indentUnitLength', () => {
  it('reports source char count per level', () => {
    expect(indentUnitLength({ kind: 'space', width: 2 })).toBe(2);
    expect(indentUnitLength({ kind: 'space', width: 4 })).toBe(4);
    expect(indentUnitLength({ kind: 'tab' })).toBe(1);
  });
});

describe('indentVisualMultiplier', () => {
  it('produces a 4-visual-column level for each unit', () => {
    expect(indentVisualMultiplier({ kind: 'space', width: 2 })).toBe(2);
    expect(indentVisualMultiplier({ kind: 'space', width: 4 })).toBe(1);
    expect(indentVisualMultiplier({ kind: 'tab' })).toBe(4);
  });
});
