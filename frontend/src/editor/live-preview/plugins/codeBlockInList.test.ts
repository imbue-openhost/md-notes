import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView, DecorationSet } from '@codemirror/view';
import { markdown, markdownLanguage } from '../../lang-markdown/index';
import { codeBlockField } from './codeBlock';

interface DecoSpec {
  from: number;
  to: number;
  cls?: string;
  style?: string;
}

function buildState(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage }),
      codeBlockField({ interaction: 'inline' }),
    ],
  });
  return state.update({}).state;
}

function collectDecorations(state: EditorState): DecoSpec[] {
  // codeBlockField registers via EditorView.decorations facet. In a
  // node test we don't have a view, but the facet is readable from
  // state — its values are DecorationSets or fns producing them.
  const entries = state.facet(EditorView.decorations) as Array<
    DecorationSet | ((view: { state: EditorState }) => DecorationSet)
  >;

  const out: DecoSpec[] = [];
  for (const entry of entries) {
    let set: DecorationSet;
    if (typeof entry === 'function') {
      // ViewPlugin's decorations function expects a view; pass a stub
      // with `state` that's enough for our codeBlock plugin.  Skip if
      // it throws (other plugins may need a real view).
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
      const spec = iter.value.spec as {
        class?: string;
        attributes?: { style?: string };
      };
      out.push({
        from: iter.from,
        to: iter.to,
        cls: spec.class,
        style: spec.attributes?.style,
      });
      iter.next();
    }
  }
  return out;
}

describe('codeBlock decorations: nested in list item', () => {
  it('top-level code block has no --cb-indent style on content lines', () => {
    const doc = '```python\nx = 1\n```\n';
    const state = buildState(doc);
    const decos = collectDecorations(state);
    const contentLines = decos.filter((d) => d.cls?.includes('cm-codeblock-content'));
    expect(contentLines.length).toBeGreaterThan(0);
    for (const d of contentLines) {
      expect(d.style ?? '').not.toContain('--cb-indent');
    }
  });

  it('list-nested code block sets --cb-indent on content lines', () => {
    const doc = '- ```python\n  x = 1\n  ```\n';
    const state = buildState(doc);
    const decos = collectDecorations(state);
    const contentLines = decos.filter((d) => d.cls?.includes('cm-codeblock-content'));
    expect(contentLines.length).toBeGreaterThan(0);
    for (const d of contentLines) {
      expect(d.style ?? '').toContain('--cb-indent: 2ch');
    }
  });

  it('deeper nesting uses the inner list item content column', () => {
    const doc = '- a\n  - ```python\n    x\n    ```\n';
    const state = buildState(doc);
    const decos = collectDecorations(state);
    const contentLines = decos.filter((d) => d.cls?.includes('cm-codeblock-content'));
    expect(contentLines.length).toBeGreaterThan(0);
    for (const d of contentLines) {
      expect(d.style ?? '').toContain('--cb-indent: 4ch');
    }
  });
});
