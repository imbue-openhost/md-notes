import { describe, expect, it } from 'vitest';
import { EditorState, Prec } from '@codemirror/state';
import { codeFolding, foldable, foldedRanges, foldNodeProp, syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { markdown, markdownLanguage } from './lang-markdown/index';
import { markdownFoldService, foldAllRecursive } from './folding';

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      // Mirrors the editor config: suppress lang-markdown's default folds for
      // non-heading blocks so only headings fold.
      markdown({
        base: markdownLanguage,
        extensions: {
          props: [
            foldNodeProp.add({
              'CodeBlock FencedCode Blockquote HorizontalRule ListItem HTMLBlock LinkReference Paragraph CommentBlock ProcessingInstructionBlock Table': () => null,
            }),
          ],
        },
      }),
      Prec.high(markdownFoldService),
      codeFolding(),
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

describe('folding on a partially parsed document', () => {
  // On state creation CodeMirror only parses a ~3000-char prefix; the rest of
  // the tree fills in asynchronously. These docs put a second heading well
  // past that window, which used to make the first section fold to the end
  // of the document — swallowing every later section, whatever its level.
  const filler = 'text\n'.repeat(2000);

  function makeFakeView(state: EditorState) {
    const obj = {
      state,
      dispatch(spec: any) {
        obj.state = obj.state.update(spec).state;
      },
    };
    return obj as unknown as EditorView;
  }

  it('does not fold past a sibling heading beyond the initial parse window', () => {
    const doc = `# A\n${filler}# B\ntail\n`;
    const state = makeState(doc);
    expect(syntaxTree(state).length).toBeLessThan(doc.length); // partial-parse precondition
    const range = foldable(state, 0, state.doc.line(1).to);
    expect(range).not.toBeNull();
    expect(range!.to).toBeLessThan(doc.indexOf('# B'));
  });

  it('foldAllRecursive folds every section, not just the parsed prefix', () => {
    const doc = `# A\nx\n${filler}# B\ny\n# C\nz\n`;
    const view = makeFakeView(makeState(doc));
    foldAllRecursive(view);
    const folds: { from: number; to: number }[] = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      folds.push({ from, to });
    });
    expect(folds.length).toBe(3);
    expect(folds[0].to).toBeLessThan(doc.indexOf('# B'));
    expect(folds[1].to).toBeLessThan(doc.indexOf('# C'));
    expect(folds[2].to).toBe(doc.length);
  });
});
