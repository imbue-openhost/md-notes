import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState, Prec } from '@codemirror/state';
import { markdown, markdownLanguage } from './lang-markdown/index';
import { codeFolding, foldEffect, foldable } from '@codemirror/language';
import { markdownFoldService } from './folding';
import { _internal } from './fold-persistence';

const { collectHeadings, currentFoldedPaths, applyPaths, hasStoredState, storageKey } = _internal;

// Minimal in-memory localStorage shim — vitest runs under node without DOM.
function installLocalStorageShim(): void {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
}

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

// Build a fake EditorView-like object that records dispatched effects and
// applies them through state.update so foldedRanges/foldState reflect them.
function makeFakeView(state: EditorState) {
  const obj = {
    state,
    dispatch(spec: any) {
      obj.state = obj.state.update(spec).state;
    },
  };
  return obj as any;
}

describe('fold persistence path serialization', () => {
  it('builds parent-heading paths for nested headings', () => {
    const doc = '# Top\n## A\ncontent\n### A1\nx\n## B\ny\n';
    const headings = collectHeadings(makeState(doc));
    const paths = headings.map((h) => h.path);
    expect(paths).toEqual([
      ['# Top'],
      ['# Top', '## A'],
      ['# Top', '## A', '### A1'],
      ['# Top', '## B'],
    ]);
  });

  it('round-trips: folded ranges → paths → re-applied folds', () => {
    const doc = '# Top\n## A\ncontent\n### A1\nx\n## B\ny\n';
    const view = makeFakeView(makeState(doc));

    // Fold ## A and ### A1 manually.
    const headings = collectHeadings(view.state);
    const a = headings.find((h) => h.text === '## A')!;
    const a1 = headings.find((h) => h.text === '### A1')!;
    const rA = foldable(view.state, a.lineFrom, a.lineTo)!;
    const rA1 = foldable(view.state, a1.lineFrom, a1.lineTo)!;
    view.dispatch({ effects: [foldEffect.of(rA), foldEffect.of(rA1)] });

    const paths = currentFoldedPaths(view.state);
    expect(paths).toEqual([
      ['# Top', '## A'],
      ['# Top', '## A', '### A1'],
    ]);

    // Re-apply on a fresh state — should fold the same headings.
    const fresh = makeFakeView(makeState(doc));
    applyPaths(fresh, paths);
    expect(currentFoldedPaths(fresh.state)).toEqual(paths);
  });

  it('drops folds whose heading no longer exists in the doc', () => {
    const original = '# Top\n## A\nstuff\n## B\nmore\n';
    const view = makeFakeView(makeState(original));
    const headings = collectHeadings(view.state);
    const a = headings.find((h) => h.text === '## A')!;
    view.dispatch({ effects: foldEffect.of(foldable(view.state, a.lineFrom, a.lineTo)!) });
    const paths = currentFoldedPaths(view.state);
    expect(paths).toEqual([['# Top', '## A']]);

    // Simulate concurrent edit: ## A renamed to ## A-renamed.
    const edited = '# Top\n## A-renamed\nstuff\n## B\nmore\n';
    const reopened = makeFakeView(makeState(edited));
    applyPaths(reopened, paths);
    expect(currentFoldedPaths(reopened.state)).toEqual([]);
  });

  it('hasStoredState distinguishes absent key from empty array', () => {
    installLocalStorageShim();
    const opts = { vault: 'v', filePath: 'a.md' };
    expect(hasStoredState(opts)).toBe(false);

    // Empty array stored — user folded then unfolded everything. This counts
    // as "the user has a saved state for this doc" so the collapse-default
    // preference should NOT override it.
    localStorage.setItem(storageKey(opts), JSON.stringify([]));
    expect(hasStoredState(opts)).toBe(true);

    localStorage.setItem(storageKey(opts), JSON.stringify([['# A']]));
    expect(hasStoredState(opts)).toBe(true);

    localStorage.removeItem(storageKey(opts));
    expect(hasStoredState(opts)).toBe(false);
  });

  it('applies saved folds to headings beyond the initial parse window', () => {
    // Only ~3000 chars are parsed when the state is created; `# B` sits far
    // past that, so applyPaths must force the parse or the fold drops.
    const filler = 'text\n'.repeat(2000);
    const doc = `# A\nx\n${filler}# B\ny\n`;
    const view = makeFakeView(makeState(doc));
    applyPaths(view, [['# B']]);
    expect(currentFoldedPaths(view.state)).toEqual([['# B']]);
  });

  it('disambiguates duplicate heading text by parent path', () => {
    const doc = '# A\n## sub\nx\n# B\n## sub\ny\n';
    const view = makeFakeView(makeState(doc));
    const headings = collectHeadings(view.state);
    // Fold only the second `## sub` (under # B).
    const subUnderB = headings.filter((h) => h.text === '## sub')[1];
    view.dispatch({
      effects: foldEffect.of(foldable(view.state, subUnderB.lineFrom, subUnderB.lineTo)!),
    });
    const paths = currentFoldedPaths(view.state);
    expect(paths).toEqual([['# B', '## sub']]);

    const fresh = makeFakeView(makeState(doc));
    applyPaths(fresh, paths);
    expect(currentFoldedPaths(fresh.state)).toEqual([['# B', '## sub']]);
  });
});
