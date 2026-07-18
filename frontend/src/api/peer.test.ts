import { describe, expect, it } from 'vitest';
import { normalizeSourceUrl, parseInviteLink } from './peer';
import { parseFederationInvite } from '../config';

describe('normalizeSourceUrl', () => {
  it('assumes https for bare hosts', () => {
    expect(normalizeSourceUrl('md-notes.alice.example.com')).toBe('https://md-notes.alice.example.com');
  });

  it('preserves explicit schemes and strips trailing slashes', () => {
    expect(normalizeSourceUrl('https://md-notes.alice.example.com//')).toBe('https://md-notes.alice.example.com');
    expect(normalizeSourceUrl('http://md-notes.harness.localhost:8123/')).toBe('http://md-notes.harness.localhost:8123');
  });

  it('trims whitespace', () => {
    expect(normalizeSourceUrl('  a.example.com ')).toBe('https://a.example.com');
  });
});

describe('parseInviteLink', () => {
  it('parses a full invite link', () => {
    expect(parseInviteLink('https://md-notes.a.example.com/federation/connect?vault=notes&secret=abc')).toEqual({
      sourceUrl: 'https://md-notes.a.example.com',
      vault: 'notes',
      secret: 'abc',
    });
  });

  it('keeps ports and http (local harness)', () => {
    expect(parseInviteLink('http://md-notes.harness.localhost:8123/federation/connect?vault=v&secret=s')).toEqual({
      sourceUrl: 'http://md-notes.harness.localhost:8123',
      vault: 'v',
      secret: 's',
    });
  });

  it('tolerates surrounding whitespace and a trailing slash', () => {
    expect(parseInviteLink('  https://a.example.com/federation/connect/?vault=v&secret=s \n')).toEqual({
      sourceUrl: 'https://a.example.com',
      vault: 'v',
      secret: 's',
    });
  });

  it('rejects non-invite URLs', () => {
    expect(parseInviteLink('not a url')).toBeNull();
    expect(parseInviteLink('https://a.example.com/some/page?secret=s')).toBeNull();
    expect(parseInviteLink('https://a.example.com/federation/connect?vault=v')).toBeNull(); // no secret
    expect(parseInviteLink('ftp://a.example.com/federation/connect?secret=s')).toBeNull();
  });
});

describe('parseFederationInvite', () => {
  it('returns null off the connect path', () => {
    expect(parseFederationInvite('/', '')).toBeNull();
    expect(parseFederationInvite('/myvault', '?secret=x')).toBeNull();
  });

  it('extracts invite params', () => {
    expect(parseFederationInvite('/federation/connect', '?vault=notes&secret=abc')).toEqual({
      vault: 'notes',
      secret: 'abc',
    });
  });

  it('tolerates a trailing slash and missing params', () => {
    expect(parseFederationInvite('/federation/connect/', '')).toEqual({ vault: '', secret: '' });
  });
});
