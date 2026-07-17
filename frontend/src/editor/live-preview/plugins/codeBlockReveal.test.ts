import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, DecorationSet } from '@codemirror/view';
import { markdown, markdownLanguage } from '../../lang-markdown/index';
import { collapseOnSelectionFacet } from '../core/facets';
import { codeBlockField } from './codeBlock';

interface DecoSpec {
  from: number;
  to: number;
  cls?: string;
  isWidget: boolean;
}

function buildState(
  doc: string,
  anchor: number,
  head = anchor,
  livePreview = true,
): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(anchor, head),
    extensions: [
      markdown({ base: markdownLanguage }),
      collapseOnSelectionFacet.of(livePreview),
      codeBlockField({ interaction: 'inline' }),
    ],
  });
  return state.update({}).state;
}

function collectDecorations(state: EditorState): DecoSpec[] {
  const entries = state.facet(EditorView.decorations) as Array<
    DecorationSet | ((view: { state: EditorState }) => DecorationSet)
  >;

  const out: DecoSpec[] = [];
  for (const entry of entries) {
    let set: DecorationSet;
    if (typeof entry === 'function') {
      try {
        set = entry({ state } as { state: EditorState });
      } catch {
        continue;
      }
    } else {
      set = entry;
    }
    const iter = set.iter();
    while (iter.value) {
      const spec = iter.value.spec as { class?: string; widget?: unknown };
      out.push({
        from: iter.from,
        to: iter.to,
        cls: spec.class,
        isWidget: !!spec.widget,
      });
      iter.next();
    }
  }
  return out;
}

const hiddenFences = (decos: DecoSpec[]) =>
  decos.filter((d) => d.cls === 'cm-codeblock-fence-hidden');
const fenceLines = (decos: DecoSpec[]) =>
  decos.filter((d) => d.cls?.includes('cm-codeblock-fence') && d.cls?.includes('cm-codeblock-content'));

const DOC = 'before\n```js\nconst x = 1;\n```\nafter\n';
// Positions: 'before\n' = 0..6, '```js' = 7..12, 'const x = 1;' = 13..25,
// '```' = 26..29, 'after' = 30..35

describe('code block fence live preview (inline mode)', () => {
  it('hides fence text when the selection is outside the block', () => {
    const decos = collectDecorations(buildState(DOC, 0));
    expect(decos.some((d) => d.isWidget)).toBe(false);
    expect(hiddenFences(decos).map((d) => [d.from, d.to])).toEqual([
      [7, 12],
      [26, 29],
    ]);
    expect(fenceLines(decos).map((d) => d.from)).toEqual([7, 26]);
  });

  it('shows fence text when the cursor is inside the block', () => {
    const decos = collectDecorations(buildState(DOC, 15));
    expect(hiddenFences(decos)).toHaveLength(0);
    expect(fenceLines(decos).map((d) => d.from)).toEqual([7, 26]);
  });

  it('treats a cursor touching the fence boundary as inside', () => {
    expect(hiddenFences(collectDecorations(buildState(DOC, 7)))).toHaveLength(0);
  });

  it('shows fence text when a selection overlaps the block', () => {
    // Selection from 'before' into the code content — the fences will be
    // part of a copy, so they must be visible.
    const decos = collectDecorations(buildState(DOC, 0, 15));
    expect(hiddenFences(decos)).toHaveLength(0);
    expect(fenceLines(decos).map((d) => d.from)).toEqual([7, 26]);
  });

  it('styles lines identically whether fences are shown or not', () => {
    const lineDecos = (cursor: number) =>
      collectDecorations(buildState(DOC, cursor))
        .filter((d) => d.cls?.includes('cm-codeblock'))
        .filter((d) => d.cls !== 'cm-codeblock-fence-hidden')
        .map((d) => ({ from: d.from, cls: d.cls }));
    expect(lineDecos(0)).toEqual(lineDecos(15));
  });

  it('styles an unclosed block to the end of the doc, last line as content', () => {
    // CommonMark extends an unclosed fence to the end of the document, and
    // so do we (like Obsidian). The last line is content, not a fence.
    const doc = 'before\n```js\nconst x = 1;';
    const decos = collectDecorations(buildState(doc, 0));
    expect(fenceLines(decos).map((d) => d.from)).toEqual([7]);
    expect(hiddenFences(decos).map((d) => [d.from, d.to])).toEqual([[7, 12]]);
    expect(
      decos.filter((d) => d.cls === 'cm-codeblock-content').map((d) => d.from),
    ).toEqual([13]);
  });

  it('hides fences even at the cursor when live preview is disabled', () => {
    const decos = collectDecorations(buildState(DOC, 15, 15, false));
    expect(hiddenFences(decos)).toHaveLength(2);
  });
});
