import { describe, expect, it } from 'vitest';
import { DEFAULT_ONLINE_SETTINGS, DEFAULT_STUN, formatTurnServers, parseTurnServers, peerServerOptions, resolveOnlineSettings } from '../../../src/app/online/onlineSettings';

describe('online settings', () => {
  it('uses the PeerJS cloud and public STUN by default', () => {
    expect(peerServerOptions(DEFAULT_ONLINE_SETTINGS)).toEqual({ iceServers: [{ urls: DEFAULT_STUN }] });
  });

  it('points at a custom signaling server and adds TURN servers', () => {
    const options = peerServerOptions({
      ...DEFAULT_ONLINE_SETTINGS,
      signaling: { mode: 'custom', host: 'peer.example.org', port: 443, path: '/myapp', key: 'k', secure: true },
      turnServers: [{ urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
    });
    expect(options).toEqual({
      host: 'peer.example.org', port: 443, path: '/myapp', key: 'k', secure: true,
      iceServers: [{ urls: DEFAULT_STUN }, { urls: 'turn:relay.example.org:3478', username: 'u', credential: 'c' }],
    });
  });

  it('reads TURN servers one per line and writes them back', () => {
    const text = '# relay\nturn:a.example:3478 alice secret\n\nturns:b.example:5349 bob pw\nhttp://nope x y\n';
    const servers = parseTurnServers(text);
    expect(servers).toEqual([
      { urls: 'turn:a.example:3478', username: 'alice', credential: 'secret' },
      { urls: 'turns:b.example:5349', username: 'bob', credential: 'pw' },
    ]);
    expect(parseTurnServers(formatTurnServers(servers))).toEqual(servers);
  });

  it('reads relay prefixes case-insensitively', () => {
    expect(parseTurnServers('TURN:a.example u c')).toEqual([{ urls: 'TURN:a.example', username: 'u', credential: 'c' }]);
  });

  it('falls back to defaults for missing or malformed stored settings', () => {
    for (const stored of [undefined, 'x', { turnServers: 'x' }, { signaling: 5 }, { playerPageUrl: 3 }, {}]) {
      expect(resolveOnlineSettings(stored)).toEqual(DEFAULT_ONLINE_SETTINGS);
    }
  });

  it('keeps valid stored fields and drops invalid relays', () => {
    const resolved = resolveOnlineSettings({
      signaling: { mode: 'custom', host: 'h.example', port: 'x', path: '/p', key: 'k', secure: false },
      turnServers: [null, { urls: 'http://x', username: 'u', credential: 'c' }, { urls: 'turn:a.example', username: 'u', credential: 'c' }],
      playerPageUrl: 'https://p.example/',
    });
    expect(resolved).toEqual({
      signaling: { mode: 'custom', host: 'h.example', port: 443, path: '/p', key: 'k', secure: false },
      turnServers: [{ urls: 'turn:a.example', username: 'u', credential: 'c' }],
      playerPageUrl: 'https://p.example/',
      logEvents: false,
      playerName: '',
      keepImages: true,
      table: null,
      shareableProperties: ['tags', 'aliases'],
    });
  });

  it('logs online play events only when the stored switch is exactly true', () => {
    expect(DEFAULT_ONLINE_SETTINGS.logEvents).toBe(false);
    expect(resolveOnlineSettings({ logEvents: true }).logEvents).toBe(true);
    expect(resolveOnlineSettings({ logEvents: 'yes' }).logEvents).toBe(false);
  });

  it("remembers the player's name and keeps images unless switched off", () => {
    expect(DEFAULT_ONLINE_SETTINGS).toMatchObject({ playerName: '', keepImages: true, table: null });
    expect(resolveOnlineSettings({ playerName: 'Anna', keepImages: false })).toMatchObject({ playerName: 'Anna', keepImages: false });
    expect(resolveOnlineSettings({ playerName: 4, keepImages: 'no' })).toMatchObject({ playerName: '', keepImages: true });
  });

  it('shares the tags and aliases of a note unless the list says otherwise', () => {
    expect(DEFAULT_ONLINE_SETTINGS.shareableProperties).toEqual(['tags', 'aliases']);
    expect(resolveOnlineSettings({ shareableProperties: [' cr ', 'tags', '', 4, 'x'.repeat(65), '  '] }).shareableProperties).toEqual(['cr', 'tags']);
    expect(resolveOnlineSettings({ shareableProperties: [] }).shareableProperties).toEqual([]);
    expect(resolveOnlineSettings({ shareableProperties: 'tags' }).shareableProperties).toEqual(['tags', 'aliases']);
    expect(resolveOnlineSettings({ shareableProperties: Array.from({ length: 80 }, (_, index) => `p${index}`) }).shareableProperties).toHaveLength(50);
  });
});
