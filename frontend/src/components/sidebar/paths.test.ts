import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../../api/types';
import {
  baseName, parentDir, joinPath, ensureMdExtension, stripMdExtension,
  isSelfOrDescendant, remapPath, selfAndAncestorDirs, entryExists,
} from './paths';

describe('path helpers', () => {
  it('splits paths', () => {
    expect(baseName('a/b/c.md')).toBe('c.md');
    expect(baseName('c.md')).toBe('c.md');
    expect(parentDir('a/b/c.md')).toBe('a/b');
    expect(parentDir('c.md')).toBe('');
  });

  it('joins paths against the root', () => {
    expect(joinPath('', 'a.md')).toBe('a.md');
    expect(joinPath('dir', 'a.md')).toBe('dir/a.md');
  });

  it('handles .md extensions', () => {
    expect(ensureMdExtension('note')).toBe('note.md');
    expect(ensureMdExtension('note.md')).toBe('note.md');
    expect(stripMdExtension('note.md')).toBe('note');
    expect(stripMdExtension('note')).toBe('note');
  });

  it('detects descendants without false prefix matches', () => {
    expect(isSelfOrDescendant('a/b', 'a')).toBe(true);
    expect(isSelfOrDescendant('a', 'a')).toBe(true);
    expect(isSelfOrDescendant('ab/c', 'a')).toBe(false);
    expect(isSelfOrDescendant('a', 'a/b')).toBe(false);
  });

  it('remaps paths under a moved ancestor', () => {
    expect(remapPath('a/b/c.md', 'a/b', 'x/b')).toBe('x/b/c.md');
    expect(remapPath('a/b', 'a/b', 'x/b')).toBe('x/b');
  });

  it('lists ancestor dirs', () => {
    expect(selfAndAncestorDirs('')).toEqual([]);
    expect(selfAndAncestorDirs('a')).toEqual(['a']);
    expect(selfAndAncestorDirs('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
  });
});

describe('entryExists', () => {
  const tree: FileEntry[] = [
    {
      name: 'dir', path: 'dir', type: 'dir', children: [
        { name: 'nested.md', path: 'dir/nested.md', type: 'file', children: null },
      ],
    },
    { name: 'top.md', path: 'top.md', type: 'file', children: null },
  ];

  it('finds top-level and nested entries', () => {
    expect(entryExists(tree, 'top.md')).toBe(true);
    expect(entryExists(tree, 'dir')).toBe(true);
    expect(entryExists(tree, 'dir/nested.md')).toBe(true);
  });

  it('misses absent entries', () => {
    expect(entryExists(tree, 'nope.md')).toBe(false);
    expect(entryExists(tree, 'dir/nope.md')).toBe(false);
    expect(entryExists(null, 'top.md')).toBe(false);
  });
});
