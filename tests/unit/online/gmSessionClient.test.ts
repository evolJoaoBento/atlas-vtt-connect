import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { MemoryNetwork } from '../../fake/MemoryTransport';

function gm(): { network: MemoryNetwork; session: GmSession; players: () => SessionPlayer[]; requests: SessionPlayer[] } {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  let players: SessionPlayer[] = [];
  const session = new GmSession(network.host('gm'), {
    title: 'Table', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: (list) => { players = list; },
  });
  session.start();
  return { network, session, players: () => players, requests };
}

describe('which app a player joins from', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends kind obsidian from Atlas, and web by default', async () => {
    const { network } = gm();
    const sent: ControlMessage[] = [];
    const transport = {
      connect: async (hostId: string) => {
        const link = await network.client().connect(hostId);
        const send = link.send.bind(link);
        link.send = (channel, data) => {
          const decoded = channel === 'control' ? decodeControl(data) : null;
          if (decoded?.kind === 'message') sent.push(decoded.message);
          send(channel, data);
        };
        return link;
      },
    };
    const atlas = new PlayerSession({ hostId: 'gm', name: 'A', playerKey: 'ka', clientVersion: '0.5.0', clientKind: 'obsidian', transport, onChange: () => {} });
    const web = new PlayerSession({ hostId: 'gm', name: 'B', playerKey: 'kb', clientVersion: '0.1.0', transport, onChange: () => {} });
    atlas.start();
    web.start();
    await vi.advanceTimersByTimeAsync(0);
    const joins = sent.flatMap((message) => (message.type === 'join' ? [[message.name, message.client]] : []));
    expect(joins).toEqual(expect.arrayContaining([['A', { kind: 'obsidian', version: '0.5.0' }], ['B', { kind: 'web', version: '0.1.0' }]]));
    expect(joins).toHaveLength(2);
    atlas.stop();
    web.stop();
  });

  it('marks Obsidian players for the GM and leaves web players unmarked', async () => {
    const { network, players } = gm();
    const atlas = await network.client().connect('gm');
    atlas.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'ka', client: { kind: 'obsidian', version: '1' } }));
    const web = await network.client().connect('gm');
    web.send('control', encodeControl({ v: 1, type: 'join', name: 'Ben', playerKey: 'kb', client: { kind: 'web', version: '1' } }));
    expect(players().map((player) => [player.name, player.client])).toEqual([['Anna', 'obsidian'], ['Ben', undefined]]);
    expect(players()[1]).not.toHaveProperty('client');
  });

  it('follows the app of a returning player', async () => {
    const { network, session, players, requests } = gm();
    const first = await network.client().connect('gm');
    first.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'ka', client: { kind: 'obsidian', version: '1' } }));
    session.allow(requests[0]!.playerId);
    first.close();
    const again = await network.client().connect('gm');
    again.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'ka', client: { kind: 'web', version: '1' } }));
    expect(players()).toEqual([{ playerId: requests[0]!.playerId, name: 'Anna', status: 'admitted' }]);
  });
});
