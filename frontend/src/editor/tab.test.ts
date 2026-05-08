import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection, type SelectionRange, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { handleTab, handleShiftTab } from './tab';

/**
 * Minimal stand-in for an EditorView. Holds a state and applies any
 * dispatched changes by reassigning state. Sufficient for the tab
 * handlers, which only touch state.doc / state.selection / state.update.
 */
function makeStubView(doc: string, range: SelectionRange, tabSize = 2): EditorView {
  const selection = EditorSelection.create([range]);
  let state = EditorState.create({
    doc,
    selection,
    extensions: [EditorState.tabSize.of(tabSize)],
  });
  const stub = {
    get state() {
      return state;
    },
    dispatch(...specs: (TransactionSpec | { changes?: unknown })[]) {
      for (const s of specs) {
        // Accept either a TransactionSpec (with changes) or a Transaction
        // (which has .state). Our handlers use both forms.
        const maybeTx = s as { state?: EditorState };
        if (maybeTx.state) {
          state = maybeTx.state;
        } else {
          state = state.update(s as TransactionSpec).state;
        }
      }
    },
  };
  return stub as unknown as EditorView;
}

describe('handleTab', () => {
  it('indents a single list line by 2 spaces', () => {
    const view = makeStubView('- foo', EditorSelection.cursor(2));
    const consumed = handleTab(view);
    expect(consumed).toBe(true);
    expect(view.state.doc.toString()).toBe('  - foo');
  });

  it('indents only list lines in a multi-line selection', () => {
    const doc = '- foo\nplain text\n- bar';
    const view = makeStubView(doc, EditorSelection.range(0, doc.length));
    handleTab(view);
    expect(view.state.doc.toString()).toBe('  - foo\nplain text\n  - bar');
  });

  it('inserts spaces on a non-list line with empty selection', () => {
    const view = makeStubView('hello', EditorSelection.cursor(2), 4);
    const consumed = handleTab(view);
    expect(consumed).toBe(true);
    expect(view.state.doc.toString()).toBe('he    llo');
  });

  it('uses tabSize when inserting on non-list line (2 spaces)', () => {
    const view = makeStubView('abc', EditorSelection.cursor(0), 2);
    handleTab(view);
    expect(view.state.doc.toString()).toBe('  abc');
  });

  it('indents the whole selected block on a non-list multi-line selection', () => {
    const doc = 'one\ntwo\nthree';
    const view = makeStubView(doc, EditorSelection.range(0, doc.length));
    handleTab(view);
    const result = view.state.doc.toString();
    for (const line of result.split('\n')) {
      expect(line.startsWith(' ')).toBe(true);
    }
  });

  it('always returns true (consumes the event)', () => {
    const view = makeStubView('', EditorSelection.cursor(0));
    expect(handleTab(view)).toBe(true);
  });

  it('returns true when read-only without modifying the doc', () => {
    let state = EditorState.create({
      doc: 'hello',
      selection: EditorSelection.cursor(2),
      extensions: [EditorState.readOnly.of(true)],
    });
    const stub = {
      get state() {
        return state;
      },
      dispatch(spec: TransactionSpec) {
        state = state.update(spec).state;
      },
    } as unknown as EditorView;
    expect(handleTab(stub)).toBe(true);
    expect(stub.state.doc.toString()).toBe('hello');
  });
});

describe('handleShiftTab', () => {
  it('dedents a single list line by 2 spaces', () => {
    const view = makeStubView('    - foo', EditorSelection.cursor(6));
    const consumed = handleShiftTab(view);
    expect(consumed).toBe(true);
    expect(view.state.doc.toString()).toBe('  - foo');
  });

  it('dedents list lines but skips non-list lines in selection', () => {
    const doc = '  - foo\n    plain\n  - bar';
    const view = makeStubView(doc, EditorSelection.range(0, doc.length));
    handleShiftTab(view);
    expect(view.state.doc.toString()).toBe('- foo\n    plain\n- bar');
  });

  it('dedents a non-list line with leading whitespace via indentLess', () => {
    const view = makeStubView('    hello', EditorSelection.cursor(6));
    const consumed = handleShiftTab(view);
    expect(consumed).toBe(true);
    // indentLess removes one indent unit (state.tabSize = 2).
    expect(view.state.doc.toString()).toBe('  hello');
  });

  it('returns true on a non-list line with no leading whitespace (no-op)', () => {
    const view = makeStubView('hello', EditorSelection.cursor(2));
    const consumed = handleShiftTab(view);
    expect(consumed).toBe(true);
    expect(view.state.doc.toString()).toBe('hello');
  });

  it('always returns true (consumes the event)', () => {
    const view = makeStubView('', EditorSelection.cursor(0));
    expect(handleShiftTab(view)).toBe(true);
  });
});
