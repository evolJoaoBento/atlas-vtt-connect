import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, SESSION_LIMITS, type SessionPlayer } from '../../../src/app/online/GmSession';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import type { PeerLink } from '../../../src/app/online/transport/types';

const join = (name: string, playerKey: string): string =>
  encodeControl({ v: 1, type: 'join', name, playerKey, client: { kind: 'web', version: '0.5.0' } });

/** A connected player end that records what the GM sent it. */
async function player(network: MemoryNetwork): Promise<{ link: PeerLink; received: ControlMessage[]; closed: () => boolean }> {
  const link = await network.client().connect('gm');
  const received: ControlMessage[] = [];
  let isClosed = false;
  link.onMessage((channel, data) => {
    const decoded = decodeControl(data);
    if (channel === 'control' && decoded.kind === 'message') received.push(decoded.message);
  });
  link.onClose(() => { isClosed = true; });
  return { link, received, closed: () => isClosed };
}

interface Harness {
  network: MemoryNetwork;
  session: GmSession;
  requests: SessionPlayer[];
  closedRequests: string[];
  players: () => SessionPlayer[];
  changes: () => number;
}

function setup(): Harness {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const closedRequests: string[] = [];
  let players: SessionPlayer[] = [];
  let changes = 0;
  const session = new GmSession(network.host('gm'), {
    title: 'Vault',
    onJoinRequest: (p) => requests.push(p),
    onRequestClosed: (id) => closedRequests.push(id),
    onPlayersChanged: (list) => { players = list; changes++; },
  });
  session.start();
  return { network, session, requests, closedRequests, players: () => players, changes: () => changes };
}

describe('GmSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('asks the GM, then admits and sends presence', async () => {
    const { network, session, requests } = setup();
    const anna = await player(network);
    anna.link.send('control', join('  Anna ', 'key-a'));
    expect(requests.map((r) => r.name)).toEqual(['Anna']);
    expect(anna.received).toEqual([]); // nothing before approval, not even presence

    session.allow(requests[0]!.playerId);
    expect(anna.received.map((m) => m.type)).toEqual(['admitted', 'presence']);
    expect(anna.received[1]).toMatchObject({ players: [{ name: 'Anna', connected: true }] });
  });

  it('denies and closes', async () => {
    const { network, session, requests, players } = setup();
    const eve = await player(network);
    eve.link.send('control', join('Eve', 'key-e'));
    session.deny(requests[0]!.playerId);
    expect(eve.received).toEqual([{ v: 1, type: 'denied', reason: 'denied' }]);
    expect(eve.closed()).toBe(true);
    expect(players()).toEqual([]);
  });

  it('expires an unanswered request', async () => {
    const { network, requests, closedRequests } = setup();
    const bob = await player(network);
    bob.link.send('control', join('Bob', 'key-b'));
    vi.advanceTimersByTime(SESSION_LIMITS.requestTimeoutMs + 1);
    expect(closedRequests).toEqual([requests[0]!.playerId]);
    expect(bob.closed()).toBe(true);
  });

  it('closes a connection that never joins', async () => {
    const { network } = setup();
    const silent = await player(network);
    vi.advanceTimersByTime(SESSION_LIMITS.joinTimeoutMs + 1);
    expect(silent.closed()).toBe(true);
  });

  it('lets an admitted player back in without asking after a drop', async () => {
    const { network, session, requests } = setup();
    const first = await player(network);
    first.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    first.link.close();
    expect(session.getPlayers()[0]!.status).toBe('gone');

    const again = await player(network);
    again.link.send('control', join('Anna', 'key-a'));
    expect(requests).toHaveLength(1);
    expect(again.received[0]).toMatchObject({ type: 'admitted', playerId: requests[0]!.playerId });
  });

  it('replaces the older tab of the same player', async () => {
    const { network, session, requests } = setup();
    const tab1 = await player(network);
    tab1.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    const tab2 = await player(network);
    tab2.link.send('control', join('Anna', 'key-a'));
    expect(tab1.received.at(-1)).toMatchObject({ type: 'bye', reason: 'replaced' });
    expect(tab1.closed()).toBe(true);
    expect(session.getPlayers()).toHaveLength(1);
    expect(tab2.received[0]).toMatchObject({ type: 'admitted' });
  });

  it('kicks and forgets the player', async () => {
    const { network, session, requests } = setup();
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    session.kick(requests[0]!.playerId);
    expect(anna.received.at(-1)).toEqual({ v: 1, type: 'denied', reason: 'kicked' });
    const back = await player(network);
    back.link.send('control', join('Anna', 'key-a'));
    expect(requests).toHaveLength(2); // asked again
  });

  it('marks a silent player gone and pings the rest', async () => {
    const { network, session, requests } = setup();
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    vi.advanceTimersByTime(SESSION_LIMITS.pingIntervalMs + 1);
    expect(anna.received.some((m) => m.type === 'ping')).toBe(true);
    vi.advanceTimersByTime(SESSION_LIMITS.pingTimeoutMs + SESSION_LIMITS.pingIntervalMs);
    expect(session.getPlayers()[0]!.status).toBe('gone');
    expect(anna.closed()).toBe(true);
  });

  it('refuses players past the cap', async () => {
    const { network, session, requests } = setup();
    for (let i = 0; i < SESSION_LIMITS.maxPlayers; i++) {
      const p = await player(network);
      p.link.send('control', join(`P${i}`, `key-${i}`));
      session.allow(requests[i]!.playerId);
    }
    const late = await player(network);
    late.link.send('control', join('Late', 'key-late'));
    expect(late.received).toEqual([{ v: 1, type: 'denied', reason: 'full' }]);
  });

  it('disconnects a peer after three invalid messages, and refuses another version', async () => {
    const { network } = setup();
    const noisy = await player(network);
    noisy.link.send('control', 'x');
    noisy.link.send('control', '{}');
    expect(noisy.closed()).toBe(false);
    noisy.link.send('control', 'nope');
    expect(noisy.closed()).toBe(true);

    const old = await player(network);
    old.link.send('control', JSON.stringify({ v: 2, type: 'join' }));
    expect(old.received).toEqual([{ v: 1, type: 'denied', reason: 'version' }]);
    expect(old.closed()).toBe(true);
  });

  it('logs a rejected message once per connection, without its contents, and not ignored types', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { network } = setup();
      const quiet = await player(network);
      quiet.link.send('control', JSON.stringify({ v: 1, type: 'from-the-future' }));
      expect(warn).not.toHaveBeenCalled();

      const noisy = await player(network);
      noisy.link.send('control', 'secret-payload');
      noisy.link.send('control', '{}');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain('not-json');
      expect(String(warn.mock.calls[0]![0])).not.toContain('secret-payload');

      const old = await player(network);
      old.link.send('control', JSON.stringify({ v: 2, type: 'join' }));
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[1]![0])).toContain('version');
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects a name that is only whitespace', async () => {
    const { network, requests } = setup();
    const blank = await player(network);
    blank.link.send('control', join('   ', 'key-x'));
    expect(requests).toEqual([]);
    expect(blank.received).toEqual([{ v: 1, type: 'denied', reason: 'denied' }]);
  });

  it('says goodbye on stop, and ignores a late allow', async () => {
    const { network, session, requests, closedRequests } = setup();
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    const bob = await player(network);
    bob.link.send('control', join('Bob', 'key-b'));
    session.stop();
    expect(anna.received.at(-1)).toEqual({ v: 1, type: 'bye', reason: 'ended' });
    expect(closedRequests).toContain(requests[1]!.playerId);
    session.allow(requests[1]!.playerId);
    expect(bob.received.some((m) => m.type === 'admitted')).toBe(false);
  });

  it('hands other messages to handlers', async () => {
    const { network, session, requests } = setup();
    const seen: string[] = [];
    session.use({ onMessage: (_p, m) => seen.push(m.type), onAdmitted: (p) => seen.push(`in:${p.name}`) });
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    anna.link.send('control', encodeControl({ v: 1, type: 'bye', reason: 'x' }));
    expect(seen).toEqual(['in:Anna']);
  });

  it('does not let a gone player back in when the session is full', async () => {
    const { network, session, requests } = setup();
    const first = await player(network);
    first.link.send('control', join('P0', 'key-0'));
    session.allow(requests[0]!.playerId);
    for (let i = 1; i < SESSION_LIMITS.maxPlayers; i++) {
      const p = await player(network);
      p.link.send('control', join(`P${i}`, `key-${i}`));
      session.allow(requests[i]!.playerId);
    }
    first.link.close();
    const newcomer = await player(network);
    newcomer.link.send('control', join('New', 'key-new'));
    session.allow(requests[SESSION_LIMITS.maxPlayers]!.playerId);

    const back = await player(network);
    back.link.send('control', join('P0', 'key-0'));
    expect(back.received).toEqual([{ v: 1, type: 'denied', reason: 'full' }]);
    expect(session.getPlayers().filter((p) => p.status === 'admitted')).toHaveLength(SESSION_LIMITS.maxPlayers);
    expect(session.getPlayers().find((p) => p.name === 'P0')!.status).toBe('gone');
  });

  it('treats a kick as a removal, not a drop', async () => {
    const { network, session, requests, changes } = setup();
    const gone: string[] = [];
    session.use({ onGone: (p) => gone.push(p.name) });
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    const before = changes();
    session.kick(requests[0]!.playerId);
    expect(gone).toEqual([]);
    expect(changes() - before).toBe(1);
    expect(session.getPlayers()).toEqual([]);
  });

  it('closes a request exactly once for allow, deny, full and withdrawal', async () => {
    const { network, session, requests, closedRequests } = setup();
    const a = await player(network);
    a.link.send('control', join('A', 'key-a'));
    session.allow(requests[0]!.playerId);
    const b = await player(network);
    b.link.send('control', join('B', 'key-b'));
    session.deny(requests[1]!.playerId);
    const c = await player(network);
    c.link.send('control', join('C', 'key-c'));
    c.link.close();
    expect(closedRequests).toEqual([requests[0]!.playerId, requests[1]!.playerId, requests[2]!.playerId]);
  });

  it('closes a request once when allow finds the session full', async () => {
    const { network, session, requests, closedRequests } = setup();
    const waiting = await player(network);
    waiting.link.send('control', join('Wait', 'key-w'));
    for (let i = 0; i < SESSION_LIMITS.maxPlayers; i++) {
      const p = await player(network);
      p.link.send('control', join(`P${i}`, `key-${i}`));
      session.allow(requests[i + 1]!.playerId);
    }
    session.allow(requests[0]!.playerId);
    expect(waiting.received).toEqual([{ v: 1, type: 'denied', reason: 'full' }]);
    expect(closedRequests.filter((id) => id === requests[0]!.playerId)).toEqual([requests[0]!.playerId]);
    expect(closedRequests).toHaveLength(SESSION_LIMITS.maxPlayers + 1);
  });

  it('keeps the approved name when the same key rejoins', async () => {
    const { network, session } = setup();
    const first = await player(network);
    first.link.send('control', join('Anna', 'key-a'));
    const second = await player(network);
    second.link.send('control', join('Mallory', 'key-a'));
    expect(session.getPlayers()).toMatchObject([{ name: 'Anna', status: 'pending' }]);
  });

  it('limits open join requests', async () => {
    const { network, requests } = setup();
    for (let i = 0; i < SESSION_LIMITS.maxPendingRequests; i++) {
      const p = await player(network);
      p.link.send('control', join(`P${i}`, `key-${i}`));
    }
    const extra = await player(network);
    extra.link.send('control', join('Extra', 'key-extra'));
    expect(requests).toHaveLength(SESSION_LIMITS.maxPendingRequests);
    expect(extra.received).toEqual([{ v: 1, type: 'denied', reason: 'full' }]);
  });

  it('ignores a second start and a start after stop', async () => {
    const { network, session, requests } = setup();
    session.start();
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    vi.advanceTimersByTime(SESSION_LIMITS.pingIntervalMs + 1);
    expect(anna.received.filter((m) => m.type === 'ping')).toHaveLength(1);
    session.stop();
    session.start();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never sends presence to a pending player', async () => {
    const { network, session, requests } = setup();
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    const bob = await player(network);
    bob.link.send('control', join('Bob', 'key-b'));
    const cy = await player(network);
    cy.link.send('control', join('Cy', 'key-c'));
    session.allow(requests[2]!.playerId);
    expect(bob.received).toEqual([]);
  });

  it("passes admitted players' asset data to handlers and gives out their assets channel", async () => {
    const { network, session, requests } = setup();
    const received: Array<[string, unknown]> = [];
    session.use({ onAssetData: (who, data) => received.push([who.name, data]) });
    const anna = await player(network);
    const atAnna: unknown[] = [];
    anna.link.onMessage((channel, data) => { if (channel === 'assets') atAnna.push(data); });

    anna.link.send('control', join('Anna', 'key-a'));
    anna.link.send('assets', 'too early');
    expect(received).toEqual([]);
    const playerId = requests[0]!.playerId;
    expect(session.assetChannel(playerId)).toBeNull();

    session.allow(playerId);
    anna.link.send('assets', 'hello');
    expect(received).toEqual([['Anna', 'hello']]);
    const port = session.assetChannel(playerId)!;
    port.send('image');
    expect(atAnna).toEqual(['image']);
    expect(port.bufferedAmount()).toBe(0);
    let closed = 0;
    port.onClose(() => closed++);

    session.kick(playerId);
    expect(closed).toBe(1);
    expect(session.assetChannel(playerId)).toBeNull();
  });

  it("ignores asset data from a replaced tab's old link and serves the new one", async () => {
    const { network, session, requests } = setup();
    const received: unknown[] = [];
    session.use({ onAssetData: (_who, data) => received.push(data) });
    const first = await player(network);
    first.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    const second = await player(network);
    second.link.send('control', join('Anna', 'key-a'));
    first.link.send('assets', 'stale');
    second.link.send('assets', 'fresh');
    expect(received).toEqual(['fresh']);
    const atSecond: unknown[] = [];
    second.link.onMessage((channel, data) => { if (channel === 'assets') atSecond.push(data); });
    session.assetChannel(requests[0]!.playerId)!.send('to-new');
    expect(atSecond).toEqual(['to-new']);
  });

  it('hands handlers only what players may send: scene-resync and token-move', async () => {
    const { network, session, requests } = setup();
    const seen: string[] = [];
    session.use({ onMessage: (_p, m) => seen.push(m.type) });
    const anna = await player(network);
    anna.link.send('control', join('Anna', 'key-a'));
    session.allow(requests[0]!.playerId);
    const sent: ControlMessage[] = [
      { v: 1, type: 'scene-clear', seq: 1 },
      { v: 1, type: 'token-control', tokenIds: ['hero'] },
      { v: 1, type: 'token-move-refused', tokenId: 'hero' },
      { v: 1, type: 'presence', players: [] },
      { v: 1, type: 'scene-resync', seq: 0 },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: 1, y: 2 },
    ];
    for (const message of sent) anna.link.send('control', encodeControl(message));
    expect(seen).toEqual(['scene-resync', 'token-move']);
    // Dropped, not invalid: no strikes, the connection stays.
    expect(anna.closed()).toBe(false);
  });
});
