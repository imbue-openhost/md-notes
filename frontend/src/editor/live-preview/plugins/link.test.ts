import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '../../lang-markdown/index';
import { collapseOnSelectionFacet } from '../core/facets';
import { mouseSelectingField } from '../core/mouseSelecting';
import { buildLinkDecorations, parseLinkSyntax, parseWikiLink } from './link';
import type { LinkOptions } from '../widgets/linkWidget';

const options: Required<LinkOptions> = {
  openInNewTab: true,
  onWikiLinkClick: () => {},
  showPreview: false,
};

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

// Collect [kind, from, to] entries: 'widget' for replaced links, 'source' for marked ones.
function linkDecos(doc: string, cursor: number): Array<[string, string]> {
  const state = makeState(doc, cursor);
  const set = buildLinkDecorations(
    state,
    [{ from: 0, to: state.doc.length }],
    options
  );
  const out: Array<[string, string]> = [];
  const iter = set.iter();
  while (iter.value) {
    const kind = iter.value.spec.widget ? 'widget' : 'source';
    out.push([kind, doc.slice(iter.from, iter.to)]);
    iter.next();
  }
  return out;
}

describe('standard links', () => {
  const doc = 'see [docs](https://example.com) here\nx\n';

  it('renders a widget when the cursor is outside the link', () => {
    expect(linkDecos(doc, doc.indexOf('x\n'))).toEqual([
      ['widget', '[docs](https://example.com)'],
    ]);
  });

  it('shows source when the cursor is inside the link', () => {
    expect(linkDecos(doc, doc.indexOf('docs'))).toEqual([
      ['source', '[docs](https://example.com)'],
    ]);
  });

  it('ignores image syntax', () => {
    const img = 'a ![alt](pic.png) b\nx\n';
    expect(linkDecos(img, img.indexOf('x\n'))).toEqual([]);
  });

  it('ignores links inside inline code', () => {
    const code = 'a `[t](u)` b\nx\n';
    expect(linkDecos(code, code.indexOf('x\n'))).toEqual([]);
  });
});

describe('wiki links', () => {
  const doc = 'go to [[Some Note]] now\nx\n';

  it('renders a widget when the cursor is outside', () => {
    expect(linkDecos(doc, doc.indexOf('x\n'))).toEqual([
      ['widget', '[[Some Note]]'],
    ]);
  });

  it('shows source when the cursor is inside', () => {
    expect(linkDecos(doc, doc.indexOf('Some'))).toEqual([
      ['source', '[[Some Note]]'],
    ]);
  });
});

describe('parsers', () => {
  it('parses text, url and title', () => {
    expect(parseLinkSyntax('[t](u "hi")')).toEqual({
      text: 't',
      url: 'u',
      title: 'hi',
      isWikiLink: false,
    });
  });

  it('parses wiki display text', () => {
    expect(parseWikiLink('[[target|shown]]')).toEqual({
      text: 'shown',
      url: 'target',
      isWikiLink: true,
    });
  });
});
