import { describe, expect, it } from 'vitest';
import { parseInviteLink } from './invites';
import { parseFederationInvite } from '../config';

describe('parseInviteLink', () => {
  it('parses a full invite link', () => {
    expect(parseInviteLink('https://md-notes.a.example.com/federation/connect?vault=notes&secret=abc')).toEqual({
      host: 'https://md-notes.a.example.com',
      vault: 'notes',
      secret: 'abc',
    });
  });

  it('keeps ports and http (local harness)', () => {
    expect(parseInviteLink('http://md-notes.harness.localhost:8123/federation/connect?vault=v&secret=s')).toEqual({
      host: 'http://md-notes.harness.localhost:8123',
      vault: 'v',
      secret: 's',
    });
  });

  it('tolerates surrounding whitespace and a trailing slash', () => {
    expect(parseInviteLink('  https://a.example.com/federation/connect/?vault=v&secret=s \n')).toEqual({
      host: 'https://a.example.com',
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
