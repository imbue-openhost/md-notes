import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '../../lang-markdown/index';
import { buildCodeSelectionDecorations } from './codeBlock';

function buildState(doc: string, anchor: number, head: number): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [markdown({ base: markdownLanguage })],
  });
  return state.update({}).state;
}

function selectionMarks(state: EditorState): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const iter = buildCodeSelectionDecorations(state).iter();
  while (iter.value) {
    out.push({ from: iter.from, to: iter.to });
    iter.next();
  }
  return out;
}

describe('code block selection decorations', () => {
  it('marks selected code block content, clipped to the fences', () => {
    const doc = 'text\n```js\nconst x = 1;\n```\n';
    const state = buildState(doc, 0, doc.length);
    const marks = selectionMarks(state);
    expect(marks).toHaveLength(1);
    expect(state.doc.sliceString(marks[0].from, marks[0].to)).toBe('const x = 1;');
  });

  it('clips the mark to the selected part of the content', () => {
    const doc = '```js\nconst x = 1;\n```\n';
    const state = buildState(doc, 12, 17);
    const marks = selectionMarks(state);
    expect(marks).toHaveLength(1);
    expect(state.doc.sliceString(marks[0].from, marks[0].to)).toBe(
      state.doc.sliceString(12, 17),
    );
  });

  it('returns no marks for an empty selection', () => {
    const state = buildState('```js\nconst x = 1;\n```\n', 8, 8);
    expect(selectionMarks(state)).toHaveLength(0);
  });

  it('returns no marks for inline code (translucent bg shows the selection layer)', () => {
    const doc = 'before `code` after';
    const state = buildState(doc, 0, doc.length);
    expect(selectionMarks(state)).toHaveLength(0);
  });
});
