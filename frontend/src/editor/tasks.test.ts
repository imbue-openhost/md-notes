import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { toggleTaskAtSelection } from './tasks';

function run(initial: string, anchor: number, head = anchor) {
  const state = EditorState.create({
    doc: initial,
    selection: EditorSelection.range(anchor, head),
  });
  let doc = initial;
  const view = {
    state,
    dispatch: (spec: TransactionSpec) => {
      doc = state.update(spec).newDoc.toString();
    },
  } as unknown as EditorView;
  const handled = toggleTaskAtSelection(view);
  return { handled, doc };
}

describe('toggleTaskAtSelection cycle', () => {
  it('bullet → unchecked', () => {
    expect(run('- foo', 3).doc).toBe('- [ ] foo');
  });

  it('unchecked → checked', () => {
    expect(run('- [ ] foo', 3).doc).toBe('- [x] foo');
  });

  it('checked → bullet (cycle wraps)', () => {
    expect(run('- [x] foo', 3).doc).toBe('- foo');
  });

  it('numbered list items participate in the cycle', () => {
    expect(run('1. [x] foo', 3).doc).toBe('1. foo');
  });

  it('plain line becomes an unchecked task', () => {
    expect(run('foo', 1).doc).toBe('- [ ] foo');
  });

  it('indented plain line keeps its indent', () => {
    expect(run('  foo', 3).doc).toBe('  - [ ] foo');
  });

  it('empty line becomes an empty task', () => {
    expect(run('', 0).doc).toBe('- [ ] ');
  });

  it('multi-line plain selection converts every line', () => {
    expect(run('a\nb', 0, 3).doc).toBe('- [ ] a\n- [ ] b');
  });

  it('mixed statuses: only the lowest advances', () => {
    expect(run('- a\n- [x] b', 0, 10).doc).toBe('- [ ] a\n- [x] b');
  });

  it('uniform selection advances together', () => {
    expect(run('- [ ] a\n- [ ] b', 0, 15).doc).toBe('- [x] a\n- [x] b');
  });

  it('uniform checked selection returns to bullets', () => {
    expect(run('- [x] a\n- [x] b', 0, 15).doc).toBe('- a\n- b');
  });
});
