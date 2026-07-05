import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFreshIdbCache } from './sync';

type DeleteOutcome = 'success' | 'blocked' | 'error';

function stubIndexedDB(outcome: DeleteOutcome, deleted: string[]) {
  vi.stubGlobal('indexedDB', {
    deleteDatabase: (name: string) => {
      const req: any = {};
      queueMicrotask(() => {
        if (outcome === 'success') {
          deleted.push(name);
          req.onsuccess?.();
        } else if (outcome === 'blocked') {
          req.onblocked?.();
        } else {
          req.onerror?.();
        }
      });
      return req;
    },
  });
}

describe('ensureFreshIdbCache', () => {
  const store = new Map<string, string>();
  const deleted: string[] = [];

  beforeEach(() => {
    store.clear();
    deleted.length = 0;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears the cache and records the epoch when no marker exists', async () => {
    stubIndexedDB('success', deleted);
    expect(await ensureFreshIdbCache('mdnotes:vault:v:doc.md')).toBe(true);
    expect(deleted).toEqual(['mdnotes:vault:v:doc.md']);
    expect(store.get('mdnotes:crdt-epoch:mdnotes:vault:v:doc.md')).toBeDefined();
  });

  it('does not delete when the marker matches the current epoch', async () => {
    stubIndexedDB('success', deleted);
    await ensureFreshIdbCache('key');
    deleted.length = 0;
    expect(await ensureFreshIdbCache('key')).toBe(true);
    expect(deleted).toEqual([]);
  });

  it('clears again when the marker is from an older epoch', async () => {
    stubIndexedDB('success', deleted);
    store.set('mdnotes:crdt-epoch:key', '0');
    expect(await ensureFreshIdbCache('key')).toBe(true);
    expect(deleted).toEqual(['key']);
  });

  it('fails (and records nothing) when the delete is blocked by another tab', async () => {
    stubIndexedDB('blocked', deleted);
    expect(await ensureFreshIdbCache('key')).toBe(false);
    expect(store.has('mdnotes:crdt-epoch:key')).toBe(false);
  });

  it('fails when the delete errors', async () => {
    stubIndexedDB('error', deleted);
    expect(await ensureFreshIdbCache('key')).toBe(false);
  });
});
