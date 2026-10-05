/** Three Atlases over `MemoryTransport`: the GM's session with its share host, and two Obsidian players with share links. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../../src/app/online/GmSession';
import { PlayerSession } from '../../../../src/app/online/PlayerSession';
import type { TableProof } from '../../../../src/app/online/protocol';
import { GmShareHost } from '../../../../src/app/online/sharing/transport/GmShareHost';
import { PlayerShareLink } from '../../../../src/app/online/sharing/transport/PlayerShareLink';
import { MemoryNetwork } from '../../../../src/app/online/transport/MemoryTransport';
import { nodeHash } from '../assetFixtures';
import { noteCatalogue, TABLE_ID, testPerson } from './sharingFixtures';

const proof = (personId: string): TableProof => ({ id: TABLE_ID, key: 'K'.repeat(120), personId, gmName: 'Morgan', sig: 'S'.repeat(86) });
const gmPerson = testPerson('gm', 'Morgan');
const ana = testPerson('ana', 'Ana');
const ben = testPerson('ben', 'Ben');

async function world() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), { title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: () => {} });
  gm.start();
  const gmNotes = noteCatalogue({ 'Lore/Map.md': { text: 'The realm.', share: 'public' } }, [ana, ben]);
  const host = new GmShareHost({ session: gm, tableId: TABLE_ID, catalogue: gmNotes, hash: nodeHash });
  host.start();
  const join = async (person: typeof ana, notes: ReturnType<typeof noteCatalogue>) => {
    const link = new PlayerShareLink({ catalogue: notes, hash: nodeHash });
    const session = new PlayerSession({
      hostId: 'gm', name: person.name, playerKey: `key-${person.personId}`, clientVersion: '1', clientKind: 'obsidian',
      transport: network.client(), onChange: () => {}, share: link,
    });
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    gm.allow(requests.at(-1)!.playerId, { personId: person.personId, table: proof(person.personId) });
    await vi.advanceTimersByTimeAsync(0);
    link.activate({ tableId: TABLE_ID, personId: person.personId });
    return { link, session };
  };
  const clue = { text: 'For Ben.\n%% not for him %%', share: ['Ben'] };
  const anaSide = await join(ana, noteCatalogue({ 'Notes/Clue.md': clue }, [gmPerson, ben]));
  const benSide = await join(ben, noteCatalogue({}, []));
  const settle = async <T>(promise: Promise<T>): Promise<T> => {
    for (let i = 0; i < 50; i++) await vi.advanceTimersByTimeAsync(0);
    return promise;
  };
  return { gm, host, anaSide, benSide, settle };
}

describe('sharing in a session', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a player lists and pulls from the GM', async () => {
    const { gm, host, anaSide, settle } = await world();
    const items = await settle(anaSide.link.node!.requestList('gm'));
    expect(items.map((item) => item.title)).toEqual(['Map']);
    const pulled = await settle(anaSide.link.node!.pull('gm', items[0]!.item, 'note'));
    expect(new TextDecoder().decode(pulled.bytes)).toBe('The realm.');
    host.stop();
    gm.stop();
  });

  it('a player pulls from another player through the GM, which keeps nothing of it', async () => {
    const { gm, host, benSide, settle } = await world();
    const items = await settle(benSide.link.node!.requestList('ana'));
    expect(items.map((item) => item.title)).toEqual(['Clue']);
    const pulled = await settle(benSide.link.node!.pull('ana', items[0]!.item, 'note'));
    expect(new TextDecoder().decode(pulled.bytes)).toBe('For Ben.');
    expect(host.relayMappings()).toBe(0);
    expect(host.people().map((person) => person.personId).sort()).toEqual(['ana', 'ben']);
    host.stop();
    gm.stop();
  });

  it('answers for whoever really asked: the GM stamps the sender', async () => {
    const { gm, host, anaSide, benSide, settle } = await world();
    expect((await settle(benSide.link.node!.requestList('ana'))).map((item) => item.title)).toEqual(['Clue']);
    // Ana asking her own catalogue through the GM is answered for Ana, with whom none of it is shared.
    expect(await settle(anaSide.link.node!.requestList('ana'))).toEqual([]);
    host.stop();
    gm.stop();
  });
});
