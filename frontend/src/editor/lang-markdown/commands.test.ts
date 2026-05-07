import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type Transaction } from '@codemirror/state';
import { markdown, markdownLanguage, insertNewlineContinueMarkup } from './index';

function run(initial: string, anchor: number) {
  let state = EditorState.create({
    doc: initial,
    selection: EditorSelection.cursor(anchor),
    extensions: [markdown({ base: markdownLanguage })],
  });
  state = state.update({}).state;
  const captured: { tr?: Transaction } = {};
  insertNewlineContinueMarkup({
    state,
    dispatch: (tr) => {
      captured.tr = tr as Transaction;
    },
  });
  return captured.tr ? captured.tr.newDoc.toString() : state.doc.toString();
}

describe('insertNewlineContinueMarkup (patched)', () => {
  it('continues a tight list with a single newline', () => {
    expect(run('- foo', 5)).toBe('- foo\n- ');
  });

  it('continues a non-tight list tightly (no extra blank line)', () => {
    // Cursor at end of "asdf" (pos 6) in a non-tight list.
    const doc = '- asdf\n\n\n- platform';
    expect(run(doc, 6)).toBe('- asdf\n- \n\n\n- platform');
  });

  it('continues numbered lists with incremented marker', () => {
    expect(run('1. foo', 6)).toBe('1. foo\n2. ');
  });

  it('continues task-list items with unchecked marker', () => {
    expect(run('- [x] done', 10)).toBe('- [x] done\n- [ ] ');
  });

  it('exits the list on Enter at an empty bullet', () => {
    // doc has two items, cursor after empty marker on second
    const doc = '- foo\n- ';
    const result = run(doc, 8);
    expect(result).toBe('- foo\n');
  });
});
