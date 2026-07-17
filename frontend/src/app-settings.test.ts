import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getShellPreference,
  setShellPreference,
  detectShellKind,
  resolveShellKind,
  _internal,
} from './app-settings';

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

function installWindowShim(opts: { coarse: boolean; screenMin: number }): void {
  (globalThis as any).window = {
    matchMedia: (query: string) => ({ matches: query.includes('coarse') ? opts.coarse : false }),
    screen: { width: opts.screenMin, height: opts.screenMin * 2 },
  };
}

afterEach(() => {
  delete (globalThis as any).window;
});

describe('shell preference storage', () => {
  beforeEach(() => installLocalStorageShim());

  it('defaults to auto when unset', () => {
    expect(getShellPreference()).toBe('auto');
  });

  it('round-trips desktop/mobile; auto is stored as absence', () => {
    setShellPreference('mobile');
    expect(localStorage.getItem(_internal.SHELL_PREFERENCE_KEY)).toBe('mobile');
    expect(getShellPreference()).toBe('mobile');

    setShellPreference('desktop');
    expect(getShellPreference()).toBe('desktop');

    setShellPreference('auto');
    expect(localStorage.getItem(_internal.SHELL_PREFERENCE_KEY)).toBeNull();
    expect(getShellPreference()).toBe('auto');
  });

  it('ignores unrecognised stored values', () => {
    localStorage.setItem(_internal.SHELL_PREFERENCE_KEY, 'tablet');
    expect(getShellPreference()).toBe('auto');
  });
});

describe('shell detection', () => {
  beforeEach(() => installLocalStorageShim());

  it('detects mobile for coarse pointer + small screen', () => {
    installWindowShim({ coarse: true, screenMin: 390 });
    expect(detectShellKind()).toBe('mobile');
  });

  it('detects desktop for fine pointer', () => {
    installWindowShim({ coarse: false, screenMin: 390 });
    expect(detectShellKind()).toBe('desktop');
  });

  it('detects desktop for coarse pointer + large screen (tablets)', () => {
    installWindowShim({ coarse: true, screenMin: 744 });
    expect(detectShellKind()).toBe('desktop');
  });

  it('falls back to desktop when window APIs are unavailable', () => {
    expect(detectShellKind()).toBe('desktop');
  });

  it('resolveShellKind: explicit preference wins over detection', () => {
    installWindowShim({ coarse: true, screenMin: 390 });
    expect(resolveShellKind('desktop')).toBe('desktop');
    expect(resolveShellKind('mobile')).toBe('mobile');
    expect(resolveShellKind('auto')).toBe('mobile');
  });
});
