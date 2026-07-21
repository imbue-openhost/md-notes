import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { markdown, markdownLanguage } from '../../lang-markdown/index';
import { spaceWidthField } from '../core/spaceWidth';
import { buildListIndentDecorations } from './listIndent';

// `spaceWidth` falls back to 4 when the field isn't installed (jsdom can't
// measure layout). Encode that here so the px math is predictable.
const SW = 4;
// The line style adds its prefix to the theme's --cm-line-pad-left var (with
// a 16px fallback), emitted verbatim as a CSS calc() — matches CM_LINE_PAD in
// core/listLineLayout.ts.
const CM_LINE_PAD = 'var(--cm-line-pad-left, 16px)';

interface DecoSpec {
  from: number;
  to: number;
  style?: string;
  cls?: string;
  isLine: boolean;
  isReplace: boolean;
  widget?: WidgetType;
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
  const { decorations } = buildListIndentDecorations(s, [{ from: 0, to: s.doc.length }]);
  return iter(decorations);
}

function iter(set: DecorationSet): DecoSpec[] {
  const out: DecoSpec[] = [];
  const it = set.iter();
  while (it.value) {
    const spec = it.value.spec as {
      attributes?: { style?: string; class?: string };
      class?: string;
      widget?: WidgetType;
    };
    const isLine = it.from === it.to && !!spec.attributes?.style;
    out.push({
      from: it.from,
      to: it.to,
      style: spec.attributes?.style,
      cls: spec.class ?? spec.attributes?.class,
      isLine,
      isReplace: it.from < it.to && !!spec.widget,
      widget: spec.widget,
    });
    it.next();
  }
  return out;
}

function lineStyleAt(decos: DecoSpec[], from: number): string | undefined {
  return decos.find((d) => d.isLine && d.from === from)?.style;
}

describe('listVisualIndentPlugin', () => {
  it('depth-1 bullet — no indent replace; line style uses 2× sw for the `- ` marker', () => {
    const state = buildState('- hello\n');
    const decos = collect(state);
    // No indent decoration on a depth-1 line (sourceIndent = 0).
    const indent = decos.find((d) => d.isReplace && d.from === 0);
    expect(indent).toBeUndefined();
    const prefix = 2 * SW;
    expect(lineStyleAt(decos, 0)).toBe(
      `text-indent: -${prefix}px; padding-inline-start: calc(${CM_LINE_PAD} + ${prefix}px);`,
    );
  });

  it('depth-2 bullet — indent replace covers leading WS; line style adds marker width', () => {
    const state = buildState('- a\n  - b\n');
    const decos = collect(state);
    // Indent replace at [4, 6) (the two leading spaces).
    const indent = decos.find((d) => d.isReplace && d.from === 4 && d.to === 6);
    expect(indent).toBeDefined();
    // prefixPx = (sourceIndent × 2 + markerLength) × sw = (4 + 2) × 4 = 24.
    const prefix = (2 * 2 + 2) * SW;
    expect(lineStyleAt(decos, 4)).toBe(
      `text-indent: -${prefix}px; padding-inline-start: calc(${CM_LINE_PAD} + ${prefix}px);`,
    );
  });

  it('depth-3 bullet — prefixPx scales with sourceIndent', () => {
    const state = buildState('- a\n  - b\n    - c\n');
    const decos = collect(state);
    const indent = decos.find((d) => d.isReplace && d.from === 10 && d.to === 14);
    expect(indent).toBeDefined();
    // prefixPx = (4 × 2 + 2) × 4 = 40.
    const prefix = (4 * 2 + 2) * SW;
    expect(lineStyleAt(decos, 10)).toBe(
      `text-indent: -${prefix}px; padding-inline-start: calc(${CM_LINE_PAD} + ${prefix}px);`,
    );
  });

  it('indent widget carries sourceIndent and depth so DOM = 2× sourceIndent spaces', () => {
    // The widget's .toDOM() requires a real `document`; the unit-test
    // env (node) doesn't provide one. Verify the constructor args
    // instead — toDOM is a 1-line `' '.repeat(sourceIndent * 2)` and is
    // covered by playwright at integration level.
    const state = buildState('- a\n  - b\n');
    const decos = collect(state);
    const indent = decos.find((d) => d.isReplace && d.from === 4 && d.to === 6)!;
    expect(indent.widget).toBeDefined();
    const w = indent.widget as unknown as { sourceIndent: number; depth: number };
    expect(w.sourceIndent).toBe(2);
    expect(w.depth).toBe(2);
  });

  it('marker decoration covers `- ` and uses the bullet widget at the line start', () => {
    const state = buildState('- hello\n');
    const decos = collect(state, 5);
    const marker = decos.find((d) => d.isReplace && d.from === 0 && d.to === 2)!;
    expect(marker).toBeDefined();
    // Widget is the bullet variant (carries `depth`, no `text` field).
    const w = marker.widget as unknown as { depth: number; text?: string };
    expect(w.depth).toBe(1);
    expect(w.text).toBeUndefined();
  });

  it('reveal-on-cursor: when cursor is on the marker, no marker replace is emitted', () => {
    const doc = '- hello\n';
    const decos = collect(buildState(doc), 0);
    const marker = decos.find((d) => d.isReplace && d.from === 0 && d.to === 2);
    expect(marker).toBeUndefined();
    // Indent + line-style behavior is unchanged.
    expect(lineStyleAt(decos, 0)).toBeDefined();
  });

  it('text after marker gets a cm-list-N mark', () => {
    const state = buildState('- hello\n');
    // Cursor far away so the marker decoration is present too.
    const decos = collect(state, 7);
    const mark = decos.find(
      (d) => d.from === 2 && d.to === 7 && d.cls === 'cm-list-1',
    );
    expect(mark).toBeDefined();
  });

  it('skips task-list lines (taskListPlugin owns their layout)', () => {
    const state = buildState('- [ ] todo\n');
    // Doc length = 11 (10 chars + trailing newline at index 10).
    const decos = collect(state, 10);
    expect(decos.length).toBe(0);
  });

  it('ordered list — marker decoration covers the digits + dot + space', () => {
    const state = buildState('1. hello\n');
    const decos = collect(state, 8);
    // ListMark range for `1.` is [0, 2); plus trailing space → [0, 3).
    const marker = decos.find((d) => d.isReplace && d.from === 0 && d.to === 3)!;
    expect(marker).toBeDefined();
    const w = marker.widget as unknown as { depth: number; text?: string };
    expect(w.text).toBe('1.');
    expect(w.depth).toBe(1);
  });

  it('rebuilds use measured space width when field is installed', () => {
    const state = EditorState.create({
      doc: '  - b\n',
      extensions: [markdown({ base: markdownLanguage }), spaceWidthField],
    });
    // CommonMark parses `  - b` as a top-level (depth-1) list with
    // sourceIndent=2. prefixPx = (2 × 2 + 2) × 4 = 24; padding adds the var.
    const { decorations } = buildListIndentDecorations(state, [{ from: 0, to: state.doc.length }]);
    const decos = iter(decorations);
    expect(lineStyleAt(decos, 0)).toBe(
      `text-indent: -24px; padding-inline-start: calc(${CM_LINE_PAD} + 24px);`,
    );
  });
});
