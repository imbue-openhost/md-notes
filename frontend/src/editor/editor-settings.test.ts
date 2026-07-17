import { beforeEach, describe, expect, it } from 'vitest';
import {
  getCollapseHeadersDefault,
  setCollapseHeadersDefault,
  getEditorKind,
  setEditorKind,
  _internal,
} from './editor-settings';

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

describe('editor settings: collapse headers default', () => {
  beforeEach(() => installLocalStorageShim());

  it('defaults to false when unset', () => {
    expect(getCollapseHeadersDefault()).toBe(false);
  });

  it('round-trips through localStorage', () => {
    setCollapseHeadersDefault(true);
    expect(localStorage.getItem(_internal.COLLAPSE_HEADERS_DEFAULT_KEY)).toBe('true');
    expect(getCollapseHeadersDefault()).toBe(true);

    setCollapseHeadersDefault(false);
    // Off state is stored as absence so we don't litter localStorage.
    expect(localStorage.getItem(_internal.COLLAPSE_HEADERS_DEFAULT_KEY)).toBeNull();
    expect(getCollapseHeadersDefault()).toBe(false);
  });
});

describe('editor settings: editor kind', () => {
  beforeEach(() => installLocalStorageShim());

  it('defaults to live-preview when unset', () => {
    expect(getEditorKind()).toBe('live-preview');
  });

  it('round-trips the vim variant through localStorage', () => {
    setEditorKind('live-preview-vim');
    expect(localStorage.getItem(_internal.EDITOR_KIND_KEY)).toBe('live-preview-vim');
    expect(getEditorKind()).toBe('live-preview-vim');

    // Default state is stored as absence so we don't litter localStorage.
    setEditorKind('live-preview');
    expect(localStorage.getItem(_internal.EDITOR_KIND_KEY)).toBeNull();
    expect(getEditorKind()).toBe('live-preview');
  });

  it('falls back to the default on an unrecognised stored value', () => {
    localStorage.setItem(_internal.EDITOR_KIND_KEY, 'wysiwyg');
    expect(getEditorKind()).toBe('live-preview');
  });
});
