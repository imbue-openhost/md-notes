import { describe, expect, it } from 'vitest';
import { EditorState, Prec } from '@codemirror/state';
import { markdown, markdownLanguage } from './lang-markdown/index';
import { codeFolding, foldedRanges } from '@codemirror/language';
import { markdownFoldService, foldAllRecursive } from './folding';
import { slugifyHeader, findHeadingBySlug, jumpToHeading } from './header-anchor';

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage }),
      Prec.high(markdownFoldService),
      codeFolding(),
    ],
  });
}

// Fake EditorView that applies dispatched effects through state.update, same
// pattern as fold-persistence.test.ts.
function makeFakeView(state: EditorState) {
  const obj = {
    state,
    dispatch(spec: any) {
      obj.state = obj.state.update(spec).state;
    },
  };
  return obj as any;
}

function foldedRangeList(state: EditorState): Array<{ from: number; to: number }> {
  const result: Array<{ from: number; to: number }> = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    result.push({ from, to });
  });
  return result;
}

describe('slugifyHeader', () => {
  it('produces github-style slugs', () => {
    expect(slugifyHeader('## How it works')).toBe('how-it-works');
    expect(slugifyHeader("### What's new?!")).toBe('whats-new');
    expect(slugifyHeader('#   Multiple   spaces  ')).toBe('multiple-spaces');
    expect(slugifyHeader('## Foo ##')).toBe('foo');
    expect(slugifyHeader('## snake_case and-hyphens')).toBe('snake_case-and-hyphens');
  });

  it('keeps unicode letters', () => {
    expect(slugifyHeader('## Café über alles')).toBe('café-über-alles');
  });

  it('accepts raw text or an existing slug as input', () => {
    expect(slugifyHeader('How it works')).toBe('how-it-works');
    expect(slugifyHeader('how-it-works')).toBe('how-it-works');
  });

  it('returns empty for mark-only headings', () => {
    expect(slugifyHeader('##')).toBe('');
  });
});

describe('findHeadingBySlug', () => {
  const doc = '# Top\nintro\n## How it works\nstuff\n## Other\nmore\n## How it works\ndupe\n';

  it('finds the first matching heading', () => {
    const state = makeState(doc);
    const h = findHeadingBySlug(state, 'how-it-works');
    expect(h).not.toBeNull();
    expect(state.doc.lineAt(h!.lineFrom).number).toBe(3);
  });

  it('matches raw (url-decoded) header text too', () => {
    const state = makeState(doc);
    const h = findHeadingBySlug(state, 'How it works');
    expect(state.doc.lineAt(h!.lineFrom).number).toBe(3);
  });

  it('returns null when nothing matches', () => {
    const state = makeState(doc);
    expect(findHeadingBySlug(state, 'does-not-exist')).toBeNull();
    expect(findHeadingBySlug(state, '')).toBeNull();
  });

  it('finds a heading beyond the initial incremental-parse frontier', () => {
    const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit\n\n'.repeat(5000);
    const state = makeState(`# Top\n\n${filler}## Way down here\ntail\n`);
    const h = findHeadingBySlug(state, 'way-down-here');
    expect(h).not.toBeNull();
    expect(state.doc.sliceString(h!.lineFrom, h!.lineTo)).toBe('## Way down here');
  });
});

describe('jumpToHeading', () => {
  const doc = '# Top\nintro\n## A\na-content\n### A1\na1-content\n## B\nb-content\n';

  it('unfolds ancestors and the target section, leaves siblings folded', () => {
    const view = makeFakeView(makeState(doc));
    foldAllRecursive(view);
    expect(foldedRangeList(view.state).length).toBe(4); // Top, A, A1, B

    const a1 = findHeadingBySlug(view.state, 'a1')!;
    jumpToHeading(view, a1);

    const folded = foldedRangeList(view.state);
    // # Top, ## A and ### A1's own fold are open; ## B stays folded.
    const bHeading = findHeadingBySlug(view.state, 'b')!;
    expect(folded.length).toBe(1);
    expect(folded[0].from).toBe(bHeading.lineTo);

    // Target line and its content are not covered by any fold.
    const a1Content = view.state.doc.toString().indexOf('a1-content');
    for (const r of folded) {
      expect(a1.lineFrom < r.from || a1.lineFrom > r.to).toBe(true);
      expect(a1Content < r.from || a1Content > r.to).toBe(true);
    }
  });

  it('puts the cursor on the heading line', () => {
    const view = makeFakeView(makeState(doc));
    foldAllRecursive(view);
    const b = findHeadingBySlug(view.state, 'b')!;
    jumpToHeading(view, b);
    expect(view.state.selection.main.anchor).toBe(b.lineFrom);
  });
});
