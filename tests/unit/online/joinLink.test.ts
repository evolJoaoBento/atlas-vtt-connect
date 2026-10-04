import { describe, expect, it } from 'vitest';
import { buildJoinUrl, parseJoinFragment, parseJoinLink } from '../../../src/app/online/joinLink';
import { DEFAULT_ONLINE_SETTINGS, DEFAULT_STUN } from '../../../src/app/online/onlineSettings';

describe('join links', () => {
  it('puts only the id in the fragment on the default server', () => {
    const url = buildJoinUrl('https://example.github.io/atlas-vtt/', 'abc_DEF-123', DEFAULT_ONLINE_SETTINGS);
    expect(url).toBe('https://example.github.io/atlas-vtt/#id=abc_DEF-123');
    expect(parseJoinFragment(new URL(url).hash)).toEqual({ hostId: 'abc_DEF-123', server: { iceServers: [{ urls: DEFAULT_STUN }] }, tableId: null });
  });

  it('carries a custom server and TURN relays, and reads them back', () => {
    const settings = {
      ...DEFAULT_ONLINE_SETTINGS,
      signaling: { mode: 'custom' as const, host: 'peer.example.org', port: 9000, path: '/', key: 'peerjs', secure: true },
      turnServers: [{ urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
    };
    const url = buildJoinUrl('https://example.github.io/atlas-vtt#old', 'gm1', settings);
    expect(url.startsWith('https://example.github.io/atlas-vtt#id=gm1&signal=')).toBe(true);
    expect(parseJoinFragment(new URL(url).hash)).toEqual({
      hostId: 'gm1',
      server: {
        host: 'peer.example.org', port: 9000, path: '/', key: 'peerjs', secure: true,
        iceServers: [{ urls: DEFAULT_STUN }, { urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
      },
      tableId: null,
    });
  });

  it('refuses incomplete or broken fragments', () => {
    expect(parseJoinFragment('')).toBeNull();
    expect(parseJoinFragment('#')).toBeNull();
    expect(parseJoinFragment('#id=')).toBeNull();
    expect(parseJoinFragment('#id=has spaces')).toBeNull();
    expect(parseJoinFragment('#id=ok&signal=%%%')).toBeNull();
    expect(parseJoinFragment('#id=ok&ice=bm90IGpzb24')).toBeNull();
  });

  const encode = (value: unknown): string => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('refuses a signal that is not a plain server description', () => {
    expect(parseJoinFragment(`#id=ok&signal=${encode([])}`)).toBeNull();
    expect(parseJoinFragment(`#id=ok&signal=${encode({ host: 5 })}`)).toBeNull();
    expect(parseJoinFragment(`#id=ok&signal=${encode({ host: 'a.example', debug: 3 })}`)).toBeNull();
    expect(parseJoinFragment(`#id=ok&signal=${encode({ host: 'a.example', config: {} })}`)).toBeNull();
    expect(parseJoinFragment(`#id=ok&signal=${encode({ host: 'a.example', port: 99999 })}`)).toBeNull();
    expect(parseJoinFragment(`#id=ok&signal=${encode({ host: 'a.example', secure: 'yes' })}`)).toBeNull();
  });

  it('refuses malformed or non-relay ice entries', () => {
    for (const ice of [[null], ['x'], [{ urls: 'http://x', username: 'u', credential: 'c' }], [{ urls: 'stun:attacker.example', username: 'u', credential: 'c' }], [{ urls: 'turn:a.example' }]]) {
      expect(parseJoinFragment(`#id=ok&ice=${encode(ice)}`)).toBeNull();
    }
    expect(parseJoinFragment(`#id=ok&ice=${encode(Array.from({ length: 9 }, () => ({ urls: 'turn:a.example', username: 'u', credential: 'c' })))}`)).toBeNull();
  });

  it('will not build a link for an invalid host id', () => {
    expect(() => buildJoinUrl('https://example.github.io/', 'bad id!', DEFAULT_ONLINE_SETTINGS)).toThrow();
  });
});

describe('parseJoinLink', () => {
  it('reads a whole pasted link or only its fragment, around spaces', () => {
    expect(parseJoinLink('  https://example.org/join/#id=gm-1  ')).toEqual(parseJoinFragment('#id=gm-1'));
    expect(parseJoinLink('#id=gm-1')?.hostId).toBe('gm-1');
  });

  it('refuses text without a fragment or with a broken one', () => {
    expect(parseJoinLink('https://example.org/join/')).toBeNull();
    expect(parseJoinLink('gm-1')).toBeNull();
    expect(parseJoinLink('https://example.org/#nothing=here')).toBeNull();
  });
});
