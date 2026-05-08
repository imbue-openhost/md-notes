import { beforeEach, describe, expect, it } from 'vitest';
import {
  getCollapseHeadersDefault,
  setCollapseHeadersDefault,
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
