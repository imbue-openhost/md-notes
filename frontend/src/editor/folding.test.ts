import { describe, expect, it } from 'vitest';
import { EditorState, Prec } from '@codemirror/state';
import { foldable } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { markdownFoldService } from './folding';

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage }),
      Prec.high(markdownFoldService),
    ],
  });
}

// Apply the fold range for the given heading text (1-based occurrence) and
// return what the user would see — folded chars replaced by '<…>'.
function foldHeading(doc: string, heading: string, occurrence = 1): string {
  const state = makeState(doc);
  const text = state.doc.toString();

  let pos = -1;
  for (let i = 0; i < occurrence; i++) {
    pos = text.indexOf(heading, pos + 1);
    if (pos === -1) throw new Error(`heading not found: ${heading}`);
  }
  const line = state.doc.lineAt(pos);
  const range = foldable(state, line.from, line.to);
  if (!range) return text;
  return text.slice(0, range.from) + '<…>' + text.slice(range.to);
}

describe('markdown header folding', () => {
  it('folds a section with no blank lines before next heading', () => {
    const doc = '## A\ncontent\n## B\nmore\n';
    expect(foldHeading(doc, '## A')).toBe('## A<…>\n## B\nmore\n');
  });

  it('absorbs a single blank line before next heading', () => {
    const doc = '## A\ncontent\n\n## B\n';
    expect(foldHeading(doc, '## A')).toBe('## A<…>\n## B\n');
  });

  it('absorbs multiple blank lines before next heading', () => {
    const doc = '## A\ncontent\n\n\n\n## B\n';
    expect(foldHeading(doc, '## A')).toBe('## A<…>\n## B\n');
  });

  it('folds the last section to end of document', () => {
    const doc = '## A\nfirst\n## B\nlast content\n';
    expect(foldHeading(doc, '## B')).toBe('## A\nfirst\n## B<…>');
  });

  it('skips deeper subheadings when looking for next sibling', () => {
    const doc = '## A\n### sub\nstuff\n\n## B\n';
    expect(foldHeading(doc, '## A')).toBe('## A<…>\n## B\n');
  });

  it('stops at a higher-level heading', () => {
    const doc = '## A\ncontent\n\n# Top\nmore\n';
    expect(foldHeading(doc, '## A')).toBe('## A<…>\n# Top\nmore\n');
  });

  it('folds a subheading independently of the parent section', () => {
    const doc = '## A\n### sub\nstuff\n\n### sub2\nmore\n';
    expect(foldHeading(doc, '### sub')).toBe(
      '## A\n### sub<…>\n### sub2\nmore\n'
    );
  });

  it('returns null when heading has no body', () => {
    // Two headings back-to-back with no content between them: nothing to fold.
    const doc = '## A\n## B\n';
    expect(foldHeading(doc, '## A')).toBe(doc);
  });

  it('produces consistent collapsed output regardless of inter-section whitespace', () => {
    // The headline regression: varying blank-line counts between sections
    // must produce the same collapsed view.
    const tight = '## A\nx\n## B\ny\n## C\nz\n';
    const loose = '## A\nx\n\n\n## B\ny\n\n## C\nz\n';
    const expectedA = '## A<…>\n## B\ny\n## C\nz\n';
    const expectedALoose = '## A<…>\n## B\ny\n\n## C\nz\n';
    expect(foldHeading(tight, '## A')).toBe(expectedA);
    // After folding A in `loose`, the remaining doc still has blanks before C
    // (those belong to B's section, not A's). What matters is that the lines
    // BETWEEN the placeholder and `## B` are identical.
    expect(foldHeading(loose, '## A')).toBe(expectedALoose);
  });
});
