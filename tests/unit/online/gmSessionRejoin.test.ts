import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { MemoryNetwork } from '../../fake/MemoryTransport';

function gm() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  let players: SessionPlayer[] = [];
  const session = new GmSession(network.host('gm'), {
    title: 'Table', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: (list) => { players = list; },
  });
  session.start();
  const join = async (name: string, playerKey: string): Promise<{ link: PeerLink; received: ControlMessage[] }> => {
    const link = await network.client().connect('gm');
    const received: ControlMessage[] = [];
    link.onMessage((channel, data) => {
      const decoded = channel === 'control' ? decodeControl(data) : null;
      if (decoded?.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name, playerKey, client: { kind: 'web', version: '1' } }));
    return { link, received };
  };
  return { session, requests, players: () => players, join };
}

describe('a player who comes back from another client', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('takes the disconnected entry of their name once allowed, so the list has one of them', async () => {
    const t = gm();
    const first = await t.join('Anna', 'k1');
    t.session.allow(t.requests[0]!.playerId);
    const annaId = t.requests[0]!.playerId;
    first.link.close();
    expect(t.players()).toEqual([{ playerId: annaId, name: 'Anna', status: 'gone' }]);

    const again = await t.join('anna', 'k2');
    // The GM is warned: not the client Anna used before.
    expect(t.requests[1]).toMatchObject({ name: 'anna', status: 'pending', sameNameAs: 'disconnected' });
    t.session.allow(t.requests[1]!.playerId);
    expect(t.players()).toEqual([{ playerId: annaId, name: 'anna', status: 'admitted' }]);
    // The new client is Anna, by her id: her tokens and scene follow it.
    expect(again.received).toContainEqual(expect.objectContaining({ type: 'admitted', playerId: annaId }));

    // And the new client's key is hers now: its reconnect is not asked about.
    again.link.close();
    await t.join('anna', 'k2');
    expect(t.requests).toHaveLength(2);
    expect(t.players()).toEqual([{ playerId: annaId, name: 'anna', status: 'admitted' }]);
  });

  it('clears every disconnected entry of that name', async () => {
    const t = gm();
    // Two Annas, allowed while the other was connected, both gone.
    const links: PeerLink[] = [];
    for (const key of ['k1', 'k2']) {
      links.push((await t.join('Anna', key)).link);
      t.session.allow(t.requests.at(-1)!.playerId);
    }
    links.forEach((link) => link.close());
    expect(t.players().map((player) => player.status)).toEqual(['gone', 'gone']);
    await t.join('Anna', 'k3');
    t.session.allow(t.requests.at(-1)!.playerId);
    expect(t.players()).toEqual([expect.objectContaining({ name: 'Anna', status: 'admitted' })]);
  });

  it('warns about a connected player of that name and lists both once allowed', async () => {
    const t = gm();
    await t.join('Anna', 'k1');
    t.session.allow(t.requests[0]!.playerId);
    await t.join('Anna', 'k2');
    expect(t.requests[1]?.sameNameAs).toBe('connected');
    expect(t.players()[1]?.sameNameAs).toBe('connected');
    t.session.allow(t.requests[1]!.playerId);
    expect(t.players().map((player) => [player.name, player.status])).toEqual([['Anna', 'admitted'], ['Anna', 'admitted']]);
    expect(t.players()[1]).not.toHaveProperty('sameNameAs');
  });

  it('says nothing for a new name or for the same client', async () => {
    const t = gm();
    const first = await t.join('Anna', 'k1');
    expect(t.requests[0]).not.toHaveProperty('sameNameAs');
    t.session.allow(t.requests[0]!.playerId);
    first.link.close();
    await t.join('Anna', 'k1');
    expect(t.requests).toHaveLength(1);
    await t.join('Ben', 'k2');
    expect(t.requests[1]).not.toHaveProperty('sameNameAs');
  });
});
