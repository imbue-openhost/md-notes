import { describe, expect, it } from 'vitest';
import { Annotation, EditorSelection, EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '../lang-markdown/index';
import { indentUnitField } from './indentUnitField';
import { detectPastedIndent, pasteIndentNormalization, reindentText } from './pasteIndent';
import type { IndentUnit } from './detectIndent';

describe('detectPastedIndent', () => {
  it('detects 4-space indent from a nested list', () => {
    const text = '- a\n    - b\n';
    const unit = detectPastedIndent(text);
    expect(unit).toEqual({ kind: 'space', width: 4 });
  });

  it('detects 2-space indent from a nested list', () => {
    const text = '- a\n  - b\n';
    const unit = detectPastedIndent(text);
    expect(unit).toEqual({ kind: 'space', width: 2 });
  });

  it('returns null for single-depth list (no transition)', () => {
    const text = '- a\n- b\n- c\n';
    expect(detectPastedIndent(text)).toBeNull();
  });

  it('returns null for single line', () => {
    expect(detectPastedIndent('- a')).toBeNull();
  });

  it('detects tabs', () => {
    const text = '- a\n\t- b\n';
    const unit = detectPastedIndent(text);
    expect(unit).toEqual({ kind: 'tab' });
  });
});

describe('reindentText', () => {
  const twoSpace: IndentUnit = { kind: 'space', width: 2 };
  const fourSpace: IndentUnit = { kind: 'space', width: 4 };
  const tab: IndentUnit = { kind: 'tab' };

  it('4-space → 2-space', () => {
    expect(reindentText('- a\n    - b\n        - c', fourSpace, twoSpace)).toBe(
      '- a\n  - b\n    - c',
    );
  });

  it('2-space → 4-space', () => {
    expect(reindentText('- a\n  - b\n    - c', twoSpace, fourSpace)).toBe(
      '- a\n    - b\n        - c',
    );
  });

  it('tabs → 2-space', () => {
    expect(reindentText('- a\n\t- b\n\t\t- c', tab, twoSpace)).toBe(
      '- a\n  - b\n    - c',
    );
  });

  it('2-space → tabs', () => {
    expect(reindentText('- a\n  - b\n    - c', twoSpace, tab)).toBe(
      '- a\n\t- b\n\t\t- c',
    );
  });

  it('leaves unindented lines alone', () => {
    expect(reindentText('hello\nworld', fourSpace, twoSpace)).toBe('hello\nworld');
  });
});

describe('pasteIndentNormalization (transaction filter)', () => {
  function makeState(doc: string) {
    return EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        markdown({ base: markdownLanguage }),
        indentUnitField,
        pasteIndentNormalization(),
      ],
    });
  }

  it('adjusts 4-space pasted text into a 2-space document', () => {
    // Existing doc uses 2-space indent, so indentUnitField detects 2-space.
    const state = makeState('- existing\n  - nested\n');
    const pastedText = '- top\n    - child\n';
    const tr = state.update({
      changes: { from: state.doc.length, insert: pastedText },
      userEvent: 'input.paste',
    });
    const result = tr.state.doc.toString();
    expect(result).toBe('- existing\n  - nested\n- top\n  - child\n');
  });

  it('adjusts 2-space pasted text into a 4-space document', () => {
    const state = makeState('- existing\n    - nested\n');
    const pastedText = '- top\n  - child\n';
    const tr = state.update({
      changes: { from: state.doc.length, insert: pastedText },
      userEvent: 'input.paste',
    });
    const result = tr.state.doc.toString();
    expect(result).toBe('- existing\n    - nested\n- top\n    - child\n');
  });

  it('adjusts vim put (input.type.compose) text', () => {
    const state = makeState('- existing\n  - nested\n');
    const pastedText = '- top\n    - child\n';
    const tr = state.update({
      changes: { from: state.doc.length, insert: pastedText },
      userEvent: 'input.type.compose',
    });
    const result = tr.state.doc.toString();
    expect(result).toBe('- existing\n  - nested\n- top\n  - child\n');
  });

  it('does not adjust when indent units match', () => {
    const state = makeState('- existing\n  - nested\n');
    const pastedText = '- top\n  - child\n';
    const tr = state.update({
      changes: { from: state.doc.length, insert: pastedText },
      userEvent: 'input.paste',
    });
    const result = tr.state.doc.toString();
    expect(result).toBe('- existing\n  - nested\n- top\n  - child\n');
  });

  it('does not adjust single-line inserts', () => {
    const state = makeState('- existing\n  - nested\n');
    const tr = state.update({
      changes: { from: state.doc.length, insert: '    - indented' },
      userEvent: 'input.paste',
    });
    const result = tr.state.doc.toString();
    expect(result).toBe('- existing\n  - nested\n    - indented');
  });

  it('does not adjust when pasted text has no indent transitions', () => {
    const state = makeState('- existing\n  - nested\n');
    const pastedText = '- a\n- b\n- c\n';
    const tr = state.update({
      changes: { from: state.doc.length, insert: pastedText },
      userEvent: 'input.paste',
    });
    const result = tr.state.doc.toString();
    expect(result).toBe('- existing\n  - nested\n- a\n- b\n- c\n');
  });

  it('handles deeply nested lists', () => {
    const state = makeState('- a\n  - b\n');
    const pastedText = '- one\n    - two\n        - three\n';
    const tr = state.update({
      changes: { from: state.doc.length, insert: pastedText },
      userEvent: 'input.paste',
    });
    const result = tr.state.doc.toString();
    expect(result).toBe('- a\n  - b\n- one\n  - two\n    - three\n');
  });

  // Regression tests for the sync-corruption bug: transactions not tagged as paste-like — in
  // particular y-codemirror sync transactions, which carry an annotation but no userEvent — must
  // pass through completely untouched, or the sync plugin re-applies them to the Y.Doc and
  // duplicates the document.

  it('does not touch multi-line inserts without a userEvent (remote sync load)', () => {
    const state = makeState('');
    const loaded = '- top\n    - child\n        - grandchild\n';
    const tr = state.update({
      changes: { from: 0, insert: loaded },
    });
    expect(tr.state.doc.toString()).toBe(loaded);
  });

  it('preserves annotations on non-paste transactions instead of rebuilding them', () => {
    const syncAnnotation = Annotation.define<string>();
    const state = makeState('- existing\n  - nested\n');
    const tr = state.update({
      changes: { from: state.doc.length, insert: '- top\n    - child\n' },
      annotations: [syncAnnotation.of('remote')],
    });
    expect(tr.annotation(syncAnnotation)).toBe('remote');
    expect(tr.state.doc.toString()).toBe('- existing\n  - nested\n- top\n    - child\n');
  });

  it('does not adjust a paste into an empty doc', () => {
    const state = makeState('');
    const pastedText = '- top\n    - child\n';
    const tr = state.update({
      changes: { from: 0, insert: pastedText },
      userEvent: 'input.paste',
    });
    expect(tr.state.doc.toString()).toBe(pastedText);
  });
});
