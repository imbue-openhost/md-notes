import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage, insertNewlineContinueMarkup, toggleBold } from './index';

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

// Build a fake view that exposes `state` and `dispatch` like EditorView,
// so toggleBold can be exercised without a DOM. Returns the resulting doc
// and selection after applying the (single) dispatched transaction.
function runToggleBold(initial: string, selection: { anchor: number; head: number }) {
  let state = EditorState.create({
    doc: initial,
    selection: EditorSelection.single(selection.anchor, selection.head),
    extensions: [markdown({ base: markdownLanguage })],
  });
  state = state.update({}).state;
  const fakeView = {
    get state() {
      return state;
    },
    dispatch: (tr: Transaction) => {
      state = tr.state;
    },
  } as unknown as EditorView;
  toggleBold(fakeView);
  return {
    doc: state.doc.toString(),
    main: state.selection.main,
  };
}

describe('toggleBold', () => {
  it('wraps a non-empty selection with **', () => {
    const { doc, main } = runToggleBold('foo bar', { anchor: 0, head: 3 });
    expect(doc).toBe('**foo** bar');
    expect(main.from).toBe(2);
    expect(main.to).toBe(5);
  });

  it('removes ** wrappers when selection is already bolded', () => {
    // Selection is "foo" inside "**foo**".
    const { doc, main } = runToggleBold('**foo** bar', { anchor: 2, head: 5 });
    expect(doc).toBe('foo bar');
    expect(main.from).toBe(0);
    expect(main.to).toBe(3);
  });

  it('inserts **** and places cursor between markers when no selection', () => {
    const { doc, main } = runToggleBold('hi ', { anchor: 3, head: 3 });
    expect(doc).toBe('hi ****');
    expect(main.empty).toBe(true);
    expect(main.from).toBe(5);
  });

  it('wraps selections that contain spaces', () => {
    const { doc } = runToggleBold('foo bar baz', { anchor: 4, head: 7 });
    expect(doc).toBe('foo **bar** baz');
  });

  it('reverses wrapping (idempotent toggle)', () => {
    // First call wraps, second call should unwrap.
    let cur = 'hello';
    let sel = { anchor: 0, head: 5 };
    let r = runToggleBold(cur, sel);
    expect(r.doc).toBe('**hello**');
    cur = r.doc;
    sel = { anchor: r.main.from, head: r.main.to };
    r = runToggleBold(cur, sel);
    expect(r.doc).toBe('hello');
  });
});
