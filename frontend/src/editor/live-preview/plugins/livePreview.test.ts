import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { Decoration, DecorationSet } from '@codemirror/view';
import { markdown, markdownLanguage } from '../../lang-markdown/index';
import { collapseOnSelectionFacet } from '../core/facets';
import { mouseSelectingField } from '../core/mouseSelecting';
import { buildLivePreviewDecorations } from './livePreview';

function makeState(doc: string, cursor: number): EditorState {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [
      markdown({ base: markdownLanguage }),
      collapseOnSelectionFacet.of(true),
      mouseSelectingField,
    ],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

function build(state: EditorState): DecorationSet {
  return buildLivePreviewDecorations(state, [
    { from: 0, to: state.doc.length },
  ]);
}

// What the user sees: doc text with replace-decorated (hidden) ranges removed.
function visibleText(doc: string, cursor: number): string {
  const state = makeState(doc, cursor);
  const hidden: Array<{ from: number; to: number }> = [];
  const iter = build(state).iter();
  while (iter.value) {
    if (!iter.value.spec.class) {
      hidden.push({ from: iter.from, to: iter.to });
    }
    iter.next();
  }
  let out = '';
  let pos = 0;
  for (const r of hidden) {
    out += doc.slice(pos, r.from);
    pos = r.to;
  }
  return out + doc.slice(pos);
}

function revealedMarkCount(doc: string, cursor: number): number {
  const state = makeState(doc, cursor);
  let count = 0;
  const iter = build(state).iter();
  while (iter.value) {
    if (iter.value.spec.class === 'cm-formatting-mark') count++;
    iter.next();
  }
  return count;
}

describe('header marks', () => {
  const doc = '# Hello\ntext\n';

  it('hides "# " when the cursor is on another line', () => {
    expect(visibleText(doc, doc.indexOf('text'))).toBe('Hello\ntext\n');
  });

  it('shows "#" when the cursor is anywhere on the heading line', () => {
    expect(visibleText(doc, doc.indexOf('Hello'))).toBe(doc);
    expect(revealedMarkCount(doc, doc.indexOf('Hello'))).toBe(1);
  });

  it('hides closing ATX marks with their separating space', () => {
    const closed = '## foo ##\nx\n';
    expect(visibleText(closed, closed.indexOf('x'))).toBe('foo\nx\n');
  });
});

describe('inline marks', () => {
  const doc = 'a **bold** and *it* and ~~gone~~ and `code`\nx\n';

  it('hides all marks when the cursor is on another line', () => {
    expect(visibleText(doc, doc.indexOf('x\n'))).toBe(
      'a bold and it and gone and code\nx\n'
    );
  });

  it('reveals ** when the cursor is inside the bold text, not just on the marks', () => {
    const cursor = doc.indexOf('old');
    const visible = visibleText(doc, cursor);
    expect(visible).toContain('**bold**');
    // other spans on the line stay hidden
    expect(visible).toContain('and it and');
  });

  it('reveals backticks when the cursor is inside inline code', () => {
    expect(visibleText(doc, doc.indexOf('ode'))).toContain('`code`');
  });

  it('reveals marks when the selection is adjacent to the span', () => {
    expect(visibleText(doc, doc.indexOf(' and'))).toContain('**bold**');
  });
});

describe('quote marks', () => {
  const doc = '> quoted\nafter\n';

  it('hides "> " when the cursor is elsewhere', () => {
    expect(visibleText(doc, doc.indexOf('after'))).toBe('quoted\nafter\n');
  });

  it('shows ">" when the cursor is on the quote line', () => {
    expect(visibleText(doc, doc.indexOf('quoted'))).toBe(doc);
  });
});

describe('marks handled elsewhere are left alone', () => {
  it('does not touch fenced code marks', () => {
    const doc = '```\nlet x = 1\n```\nafter\n';
    expect(visibleText(doc, doc.indexOf('after'))).toBe(doc);
  });

  it('does not touch list bullets', () => {
    const doc = '- item\nafter\n';
    expect(visibleText(doc, doc.indexOf('after'))).toBe(doc);
  });

  it('does not touch setext heading underlines', () => {
    const doc = 'Title\n===\nafter\n';
    expect(visibleText(doc, doc.indexOf('after'))).toBe(doc);
  });
});

describe('multiple cursors', () => {
  it('reveals marks at every selection range', () => {
    const doc = '# A\n**b**\n';
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([
        EditorSelection.cursor(doc.indexOf('A')),
        EditorSelection.cursor(doc.indexOf('b')),
      ]),
      extensions: [
        markdown({ base: markdownLanguage }),
        collapseOnSelectionFacet.of(true),
        mouseSelectingField,
        EditorState.allowMultipleSelections.of(true),
      ],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const set = build(state);
    let hiddenCount = 0;
    const iter = set.iter();
    while (iter.value) {
      if (!(iter.value as Decoration).spec.class) hiddenCount++;
      iter.next();
    }
    expect(hiddenCount).toBe(0);
  });
});
