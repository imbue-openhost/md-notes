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
  it('depth-1 bullet — reserves a 1ch bullet column at line start', () => {
    const state = buildState('- hello\n');
    const decos = collect(state);
    expect(lineStyleAt(decos, 0)).toBe(
      'text-indent: -1ch;padding-left: calc(16px + 1ch);',
    );
  });

  it('depth-2 bullet — 2 leading whitespace chars × 2ch + 1ch bullet = 5ch prefix', () => {
    const state = buildState('- a\n  - b\n');
    const decos = collect(state);
    expect(lineStyleAt(decos, 4)).toBe(
      'text-indent: -5ch;padding-left: calc(16px + 5ch);',
    );
  });

  it('depth-3 bullet — 4 leading whitespace chars × 2ch + 1ch = 9ch prefix', () => {
    const state = buildState('- a\n  - b\n    - c\n');
    const decos = collect(state);
    expect(lineStyleAt(decos, 10)).toBe(
      'text-indent: -9ch;padding-left: calc(16px + 9ch);',
    );
  });

  it('replaces each leading whitespace char with its own widget', () => {
    // Per-char (rather than one big replace) is what gives the cursor a
    // landing position at every char boundary in the prefix.
    const state = buildState('- a\n  - b\n');
    const decos = collect(state, 0);
    expect(decos.find((d) => d.isReplace && d.from === 4 && d.to === 5)).toBeDefined();
    expect(decos.find((d) => d.isReplace && d.from === 5 && d.to === 6)).toBeDefined();
    // Post-marker space [7,8) collapses to a 0-width replace so wrapped
    // continuation lines line up with the first-line text.
    expect(decos.find((d) => d.isReplace && d.from === 7 && d.to === 8)).toBeDefined();
  });

  it('renders the same widgets regardless of cursor position (no snap)', () => {
    const doc = '- a\n  - b\n';
    const offMarker = collect(buildState(doc), 0);
    const onMarker = collect(buildState(doc), 6);
    const inPrefix = collect(buildState(doc), 5);
    const replaceShape = (d: DecoSpec) => `${d.from}-${d.to}-${d.isReplace}`;
    const offShape = offMarker.filter((d) => d.isReplace).map(replaceShape).sort();
    const onShape = onMarker.filter((d) => d.isReplace).map(replaceShape).sort();
    const inShape = inPrefix.filter((d) => d.isReplace).map(replaceShape).sort();
    expect(onShape).toEqual(offShape);
    expect(inShape).toEqual(offShape);
  });

  it('reacts to indent changes — re-emits styling for the new doc', () => {
    const state = buildState('- hello\n');
    expect(lineStyleAt(collect(state), 0)).toBe(
      'text-indent: -1ch;padding-left: calc(16px + 1ch);',
    );

    // Simulate `>>` adding 2 leading spaces.
    const next = state.update({ changes: { from: 0, insert: '  ' } }).state;
    // Top-level lists stay at depth 1 even with leading whitespace, but
    // the prefix has grown — re-emit reflects the new sourceIndent.
    expect(lineStyleAt(collect(next), 0)).toBe(
      'text-indent: -5ch;padding-left: calc(16px + 5ch);',
    );
    expect(collect(next).find((d) => d.isReplace && d.from === 0 && d.to === 1)).toBeDefined();
    expect(collect(next).find((d) => d.isReplace && d.from === 1 && d.to === 2)).toBeDefined();
  });
});
