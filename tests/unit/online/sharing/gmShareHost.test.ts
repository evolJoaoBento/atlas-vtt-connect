/** The GM's share host over a fake session: who counts as a person, which device is reached, what is turned down. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../../src/app/online/gmSessionTypes';
import { PlayerShareLink } from '../../../../src/app/online/sharing/transport/PlayerShareLink';
import { GmShareHost } from '../../../../src/app/online/sharing/transport/GmShareHost';
import { decodeShare, encodeShare, type ShareMessage } from '../../../../src/app/online/sharing/transport/shareProtocol';
import type { ChannelPort } from '../../../../src/app/online/transport/types';
import { nodeHash } from '../assetFixtures';
import { noteCatalogue, TABLE_ID, testPerson } from './sharingFixtures';

const V = 'V'.repeat(43);
const player = (playerId: string, personId: string | undefined, status: SessionPlayer['status'] = 'admitted', client: 'obsidian' | undefined = 'obsidian'): SessionPlayer => ({
  playerId, name: personId ?? 'Web', status, ...(client ? { client } : {}), ...(personId ? { personId } : {}),
});

function room(players: SessionPlayer[]) {
  let handler: SessionHandler | null = null;
  const received = new Map<string, Array<string | ArrayBuffer>>();
  const port = (playerId: string): ChannelPort => ({
    send: (data) => { received.set(playerId, [...(received.get(playerId) ?? []), data]); },
    bufferedAmount: () => 0,
    onDrain: () => () => {},
    onClose: () => () => {},
  });
  const session = {
    use: (next: SessionHandler): (() => void) => { handler = next; return () => { handler = null; }; },
    assetChannel: (playerId: string): ChannelPort | null => (players.some((candidate) => candidate.playerId === playerId && candidate.status === 'admitted') ? port(playerId) : null),
    getPlayers: (): SessionPlayer[] => players.map((candidate) => ({ ...candidate })),
  };
  const host = new GmShareHost({ session, tableId: 'T'.repeat(43), catalogue: noteCatalogue({}, []), hash: nodeHash });
  host.start();
  const messagesTo = (playerId: string): ShareMessage[] => (received.get(playerId) ?? []).flatMap((data) => {
    const decoded = decodeShare(data);
    return decoded.kind === 'message' ? [decoded.message] : [];
  });
  const say = (from: SessionPlayer, message: ShareMessage): void => handler!.onAssetData!(from, encodeShare(message));
  return { host, players, handler: (): SessionHandler => handler!, messagesTo, say };
}

const startTo = (to: string, handle: number, req: string, kind: 'note' | 'image' = 'note'): ShareMessage => (
  kind === 'image'
    ? { v: 1, type: 'share-start', to, req, handle, size: 3, kind, version: V, mime: 'image/png' }
    : { v: 1, type: 'share-start', to, req, handle, size: 3, kind, version: V }
);
const endOf = (to: string, handle: number): ShareMessage => ({ v: 1, type: 'share-end', to, handle });

afterEach(() => { vi.restoreAllMocks(); });

describe('GmShareHost', () => {
  it('lists each person once, and only admitted Obsidian players with a person id', () => {
    const { host } = room([
      player('d1', 'ana'), player('d2', 'ana'), player('d3', 'ben'),
      player('d4', 'cara', 'gone'), player('d5', 'dan', 'pending'), player('w', undefined, 'admitted', undefined), player('d6', undefined),
    ]);
    expect(host.people().map((person) => person.personId).sort()).toEqual(['ana', 'ben']);
  });

  it('reaches the most recently admitted device of a person', () => {
    const { host, handler, messagesTo, players } = room([player('d1', 'ana'), player('d2', 'ana')]);
    handler().onAdmitted!(players[0]!);
    handler().onAdmitted!(players[1]!);
    void host.node.requestList('ana').catch(() => {});
    expect([messagesTo('d1').length, messagesTo('d2').length]).toEqual([0, 1]);
    // The first device joins again (a takeover admits it anew): it is the one reached now.
    handler().onAdmitted!(players[0]!);
    void host.node.requestList('ana').catch(() => {});
    expect([messagesTo('d1').length, messagesTo('d2').length]).toEqual([1, 1]);
  });

  it('cancels a person’s transfers only when their last device is gone', async () => {
    const { host, handler, players } = room([player('d1', 'ana'), player('d2', 'ana')]);
    handler().onAdmitted!(players[0]!);
    handler().onAdmitted!(players[1]!);
    let outcome = 'pending';
    const asked = host.node.requestList('ana').then(() => { outcome = 'listed'; }, (error: { reason: string }) => { outcome = error.reason; });
    players[0]!.status = 'gone';
    handler().onGone!({ ...players[0]!, status: 'gone' });
    await Promise.resolve();
    expect(outcome).toBe('pending');
    players[1]!.status = 'gone';
    handler().onGone!({ ...players[1]!, status: 'gone' });
    await asked;
    expect(outcome).toBe('gone');
  });

  it('turns a rate-limited start down on both sides, but not a map’s image starts', () => {
    const [ana, ben] = [player('da', 'ana'), player('db', 'ben')];
    const { say, messagesTo, host } = room([ana, ben]);
    for (let index = 0; index < 10; index++) {
      say(ana, startTo('ben', 0x8000_0000 + index, 'r'.repeat(10) + index));
      say(ana, endOf('ben', 0x8000_0000 + index));
    }
    expect(host.relayMappings()).toBe(0);
    expect(messagesTo('db').filter((message) => message.type === 'share-start')).toHaveLength(10);
    say(ana, startTo('ben', 0x8000_0100, 'late'.padEnd(11, 'x')));
    expect(messagesTo('da').at(-1)).toMatchObject({ type: 'share-cancel', handle: 0x8000_0100 });
    expect(messagesTo('db').at(-1)).toMatchObject({ type: 'share-denied', from: 'ana', req: 'late'.padEnd(11, 'x'), reason: 'busy' });
    expect(host.relayMappings()).toBe(0);
    // A map's images go one after another, bounded by queues instead of the rate.
    const before = messagesTo('db').filter((message) => message.type === 'share-start').length;
    for (let index = 0; index < 5; index++) {
      say(ana, startTo('ben', 0x8000_0200 + index, 'i'.repeat(10) + index, 'image'));
      say(ana, endOf('ben', 0x8000_0200 + index));
    }
    expect(messagesTo('db').filter((message) => message.type === 'share-start')).toHaveLength(before + 5);
  });

  it('turns a rate-limited start for the GM down: the GM’s pull fails busy, the sender stops', async () => {
    const ana = player('da', 'ana');
    const { say, messagesTo, host } = room([ana]);
    const pulled = host.node.pull('ana', 'i'.repeat(22), 'note');
    const asked = messagesTo('da').at(-1);
    const req = asked && 'req' in asked ? asked.req : '';
    for (let index = 0; index < 10; index++) say(ana, { v: 1, type: 'share-list-request', to: 'ben', req: 'l'.repeat(10) + index });
    say(ana, startTo('gm', 0x8000_0001, req));
    await expect(pulled).rejects.toMatchObject({ reason: 'busy' });
    expect(messagesTo('da').at(-1)).toMatchObject({ type: 'share-cancel', handle: 0x8000_0001 });
  });

  it('answers a request for someone who is not here as gone, and stops a transfer for them', () => {
    const ana = player('da', 'ana');
    const { say, messagesTo } = room([ana]);
    say(ana, { v: 1, type: 'share-pull', to: 'nobody', req: 'p'.repeat(11), item: 'i'.repeat(22) });
    expect(messagesTo('da').at(-1)).toMatchObject({ type: 'share-denied', from: 'nobody', req: 'p'.repeat(11), reason: 'gone' });
    say(ana, startTo('nobody', 0x8000_0005, 'q'.repeat(11)));
    expect(messagesTo('da').at(-1)).toMatchObject({ type: 'share-cancel', from: 'nobody', handle: 0x8000_0005 });
  });

  it('two pulls at once, one from the GM and one relayed from Ana, reach Ben without crossing', async () => {
    // Every counter starts at its range's first handle, so only the ranges can keep the two transfers apart.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // About 1.5 MiB each: more than the ack window, and every frame takes a turn of its own to arrive, so both are open together.
    const BIG = 'x'.repeat(1_500_000);
    const players = [player('da', 'ana'), player('db', 'ben')];
    const links = new Map<string, PlayerShareLink>();
    let handler: SessionHandler | null = null;
    const later = (run: () => void): void => { setTimeout(run, 0); };
    /** Ben's acknowledgements to the GM wait until Ana's transfer has reached him, so the GM's is still open when it does. */
    let held: Array<() => void> | null = [];
    const toGm = (from: SessionPlayer) => ({
      send: (data: string | ArrayBuffer): void => {
        const decoded = decodeShare(data);
        const ack = decoded.kind === 'message' && decoded.message.type === 'share-ack';
        const send = (): void => later(() => handler?.onAssetData?.(from, data));
        if (ack && held && from.playerId === 'db') held.push(send);
        else send();
      },
    });
    /** What Ben was told, in order: where each transfer started and ended. */
    const trace: string[] = [];
    const session = {
      use: (next: SessionHandler): (() => void) => { handler = next; return () => { handler = null; }; },
      assetChannel: (playerId: string): ChannelPort => ({
        send: (data) => later(() => {
          const decoded = decodeShare(data);
          if (playerId === 'db' && decoded.kind === 'message' && (decoded.message.type === 'share-start' || decoded.message.type === 'share-end')) {
            trace.push(`${decoded.message.type}:${decoded.message.from}`);
            if (decoded.message.type === 'share-start' && decoded.message.from === 'ana') {
              const waiting = held ?? [];
              held = null;
              waiting.forEach((release) => release());
            }
          }
          links.get(playerId)?.receive(data);
        }),
        bufferedAmount: () => 0, onDrain: () => () => {}, onClose: () => () => {},
      }),
      getPlayers: (): SessionPlayer[] => players,
    };
    const gm = new GmShareHost({
      session, tableId: TABLE_ID, hash: nodeHash,
      catalogue: noteCatalogue({ 'Lore/Big.md': { text: BIG, share: 'public' } }, [testPerson('ana', 'Ana'), testPerson('ben', 'Ben')]),
    });
    gm.start();
    const join = (who: SessionPlayer, personId: string, notes: Record<string, { text: string; share: unknown }>): PlayerShareLink => {
      const link = new PlayerShareLink({ catalogue: noteCatalogue(notes, [testPerson('ben', 'Ben')]), hash: nodeHash });
      links.set(who.playerId, link);
      link.connected({ ...toGm(who), bufferedAmount: () => 0, onDrain: () => () => {}, onClose: () => () => {} });
      link.activate({ tableId: TABLE_ID, personId });
      return link;
    };
    join(players[0]!, 'ana', { 'Notes/Huge.md': { text: BIG, share: ['Ben'] } });
    const ben = join(players[1]!, 'ben', {}).node!;
    const fromGm = (await ben.requestList('gm')).find((item) => item.title === 'Big')!;
    const fromAna = (await ben.requestList('ana')).find((item) => item.title === 'Huge')!;
    const [gmNote, anaNote] = await Promise.all([ben.pull('gm', fromGm.item, 'note'), ben.pull('ana', fromAna.item, 'note')]);
    expect([gmNote.bytes.byteLength, anaNote.bytes.byteLength]).toEqual([BIG.length, BIG.length]);
    // Both were open at once: Ana's started before the GM's ended.
    expect(trace.indexOf('share-start:ana')).toBeGreaterThanOrEqual(0);
    expect(trace.indexOf('share-start:ana')).toBeLessThan(trace.indexOf('share-end:gm'));
    expect(gm.relayMappings()).toBe(0);
    gm.stop();
  });
});
