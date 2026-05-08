import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '../../lang-markdown/index';
import { buildListIndentDecorations } from './listIndent';

interface DecoSpec {
  from: number;
  to: number;
  style?: string;
  isLine: boolean;
  isReplace: boolean;
}

function buildState(doc: string, cursor = 0) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  });
}

function collect(state: EditorState, cursor = 0): DecoSpec[] {
  const s = state.update({ selection: EditorSelection.cursor(cursor) }).state;
  const set = buildListIndentDecorations(s, [{ from: 0, to: s.doc.length }]);
  const out: DecoSpec[] = [];
  const iter = set.iter();
  while (iter.value) {
    const spec = iter.value.spec as { attributes?: { style?: string } };
    const isLine = iter.from === iter.to && !!spec.attributes;
    out.push({
      from: iter.from,
      to: iter.to,
      style: spec.attributes?.style,
      isLine,
      isReplace: iter.from < iter.to,
    });
    iter.next();
  }
  return out;
}

function lineStyleAt(decos: DecoSpec[], from: number): string | undefined {
  return decos.find((d) => d.isLine && d.from === from)?.style;
}

describe('listVisualIndentPlugin', () => {
  it('depth-1 bullet — pads bullet column to 2ch and reserves the gap', () => {
    const state = buildState('- hello\n');
    const decos = collect(state);
    expect(lineStyleAt(decos, 0)).toBe(
      'text-indent: -2ch;padding-left: calc(16px + 2ch);',
    );
  });

  it('depth-2 bullet — adds 4ch of level indent on top of the bullet column', () => {
    const state = buildState('- a\n  - b\n');
    const decos = collect(state);
    expect(lineStyleAt(decos, 4)).toBe(
      'text-indent: -2ch;padding-left: calc(16px + 6ch);',
    );
  });

  it('depth-3 bullet — 8ch of level indent', () => {
    const state = buildState('- a\n  - b\n    - c\n');
    const decos = collect(state);
    expect(lineStyleAt(decos, 10)).toBe(
      'text-indent: -2ch;padding-left: calc(16px + 10ch);',
    );
  });

  it('hides leading whitespace and post-marker space when cursor is elsewhere', () => {
    const state = buildState('- a\n  - b\n');
    const decos = collect(state, 0);
    // Depth-2 line is "  - b\n" starting at offset 4. Leading whitespace is
    // [4,6); the post-marker space is [7,8).
    expect(decos.find((d) => d.isReplace && d.from === 4 && d.to === 6)).toBeDefined();
    expect(decos.find((d) => d.isReplace && d.from === 7 && d.to === 8)).toBeDefined();
  });

  it('keeps source visible when the cursor is on the marker', () => {
    // Cursor at 6 — on the depth-2 marker.
    const state = buildState('- a\n  - b\n');
    const decos = collect(state, 6);
    const replaces = decos.filter(
      (d) => d.isReplace && d.from >= 4 && d.to <= 8,
    );
    expect(replaces).toEqual([]);
  });

  it('keeps source visible when the cursor is in the leading whitespace', () => {
    // Cursor at 5 — between the two leading spaces of the depth-2 line.
    const state = buildState('- a\n  - b\n');
    const decos = collect(state, 5);
    const replaces = decos.filter(
      (d) => d.isReplace && d.from >= 4 && d.to <= 8,
    );
    expect(replaces).toEqual([]);
  });

  it('reacts to indent changes — re-emits styling for the new doc', () => {
    const state = buildState('- hello\n');
    // Cursor away from the prefix so the prefix-reveal doesn't suppress
    // the leading-whitespace replacement we want to assert on.
    const cursor = 7;
    expect(lineStyleAt(collect(state, cursor), 0)).toBe(
      'text-indent: -2ch;padding-left: calc(16px + 2ch);',
    );

    // Simulate `>>` adding 2 leading spaces.
    const next = state.update({ changes: { from: 0, insert: '  ' } }).state;
    // Top-level lists stay at depth 1 even with leading whitespace, so the
    // line styling stays the same — but the leading-whitespace replacement
    // fires now and didn't before.
    expect(lineStyleAt(collect(next, cursor + 2), 0)).toBe(
      'text-indent: -2ch;padding-left: calc(16px + 2ch);',
    );
    const wsReplace = collect(next, cursor + 2).find(
      (d) => d.isReplace && d.from === 0 && d.to === 2,
    );
    expect(wsReplace).toBeDefined();
  });
});
