import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { setHeadingLevel } from './heading';

function run(initial: string, level: number, anchor: number, head = anchor) {
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
  const handled = setHeadingLevel(view, level);
  return { handled, doc };
}

describe('setHeadingLevel', () => {
  it('adds a heading prefix to a plain line', () => {
    expect(run('hello world', 2, 3).doc).toBe('## hello world');
  });

  it('replaces an existing heading level', () => {
    expect(run('### hello', 1, 5).doc).toBe('# hello');
  });

  it('toggles off when the line is already at that level', () => {
    expect(run('## hello', 2, 4).doc).toBe('hello');
  });

  it('level 0 strips an existing heading', () => {
    expect(run('#### hello', 0, 6).doc).toBe('hello');
  });

  it('level 0 on a plain line is a no-op', () => {
    const r = run('hello', 0, 2);
    expect(r.handled).toBe(false);
    expect(r.doc).toBe('hello');
  });

  it('works on an empty line', () => {
    expect(run('', 3, 0).doc).toBe('### ');
  });

  it('treats a bare # line as a heading', () => {
    expect(run('##', 2, 1).doc).toBe('');
  });

  it('applies to every line in a multi-line selection', () => {
    expect(run('one\n## two\nthree', 2, 0, 15).doc).toBe('## one\ntwo\n## three');
  });

  it('rejects out-of-range levels', () => {
    expect(run('hello', 7, 0).handled).toBe(false);
  });
});
