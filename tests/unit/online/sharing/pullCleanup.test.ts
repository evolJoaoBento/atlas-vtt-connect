/**
 * A pull that ends after its transfer started (a timeout, a denial, a lost sender, a take-over) must
 * close the incoming transfer and tell the sender to stop, so no slot or relay mapping leaks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../../src/app/online/gmSessionTypes';
import { GmShareHost } from '../../../../src/app/online/sharing/transport/GmShareHost';
import { PlayerShareLink } from '../../../../src/app/online/sharing/transport/PlayerShareLink';
import { SHARE_LIMITS } from '../../../../src/app/online/sharing/transport/shareLimits';
import { ShareNode } from '../../../../src/app/online/sharing/transport/ShareNode';
import { decodeShare, encodeShare, type ShareMessage } from '../../../../src/app/online/sharing/transport/shareProtocol';
import type { ChannelPort } from '../../../../src/app/online/transport/types';
import { nodeHash } from '../assetFixtures';
import { noteCatalogue, TABLE_ID } from './sharingFixtures';

const V = 'V'.repeat(43);
const ITEM = 'i'.repeat(22);
const never = (): ChannelPort['onDrain'] => () => () => {};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** A node on its own: what it sends is recorded, what it should hear is fed in by the test. */
function lone() {
  const sent: ShareMessage[] = [];
  const node = new ShareNode({
    self: 'ana', hash: nodeHash, catalogue: { list: async () => [], open: async () => null },
    send: (_to, data) => { const decoded = decodeShare(data); if (decoded.kind === 'message') sent.push(decoded.message); },
  });
  const reqOfLast = (): string => { const last = sent.at(-1); return last && 'req' in last ? last.req : ''; };
  /** Pulls, hears the start and a first chunk of the transfer, and returns the pull's outcome promise. */
  const startPull = (handle: number, version?: string): { outcome: Promise<string>; req: string } => {
    const outcome = node.pull('gm', ITEM, 'note', version).then(() => 'ok', (error: { reason: string }) => error.reason);
    const req = reqOfLast();
    node.receive('hop', { v: 1, type: 'share-start', to: 'ana', from: 'gm', req, handle, size: 10, kind: 'note', version: V });
    node.chunk('hop', { handle, bytes: new Uint8Array([1, 2, 3]) });
    return { outcome, req };
  };
  return { node, sent, startPull };
}

describe('a pull that ends after its transfer started', () => {
  it('times out: the transfer closes, the sender is told to stop, and 4 stalled pulls no longer block the next', async () => {
    const { sent, startPull } = lone();
    for (let index = 0; index < SHARE_LIMITS.incomingPerPeer + 2; index++) {
      const handle = 0x8000_0000 + index;
      const { outcome } = startPull(handle);
      // Accepted: a start refused for lack of a slot would have been cancelled at once.
      expect(sent.filter((message) => message.type === 'share-cancel' && message.handle === handle)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(SHARE_LIMITS.stallMs);
      expect(await outcome).toBe('timeout');
      // The start was accepted (never cancelled) and the stall ended it with a cancel of that handle.
      expect(sent.filter((message) => message.type === 'share-cancel').map((message) => message.type === 'share-cancel' && message.handle)).toContain(handle);
    }
    expect(sent.filter((message) => message.type === 'share-cancel')).toHaveLength(SHARE_LIMITS.incomingPerPeer + 2);
  });

  it('is denied by the sender after the start: the transfer closes and the sender is told to stop', async () => {
    const { node, sent, startPull } = lone();
    for (let index = 0; index < SHARE_LIMITS.incomingPerPeer + 1; index++) {
      const handle = 0x8000_0000 + index;
      const started = startPull(handle);
      node.receive('hop', { v: 1, type: 'share-denied', to: 'ana', from: 'gm', req: started.req, reason: 'not-shared' });
      expect(await started.outcome).toBe('not-shared');
      expect(sent.at(-1)).toMatchObject({ type: 'share-cancel', to: 'gm', handle });
    }
  });

  it('opens one transfer per pull: a second start for the same request is turned down', async () => {
    const { node, sent, startPull } = lone();
    const started = startPull(0x8000_0000);
    node.receive('hop', { v: 1, type: 'share-start', to: 'ana', from: 'gm', req: started.req, handle: 0x8000_0001, size: 10, kind: 'note', version: V });
    expect(sent.at(-1)).toMatchObject({ type: 'share-cancel', handle: 0x8000_0001 });
    node.stop();
    expect(await started.outcome).toBe('gone');
  });

  it('refuses bytes that are not the version asked for, even when the sender’s own announcement matches them', async () => {
    const network = new Map<string, ShareNode>();
    const bytes = new TextEncoder().encode('hello').buffer as ArrayBuffer;
    const real = await nodeHash(bytes);
    const other = 'O'.repeat(43);
    const make = (self: string, open: (ref: string) => Promise<{ kind: 'note' | 'image'; bytes: ArrayBuffer; version: string; mime?: 'image/png' } | null>): ShareNode => {
      const node = new ShareNode({
        self, hash: nodeHash, catalogue: { list: async () => [], open: (_person, ref) => open(ref) },
        send: (to, data) => queueMicrotask(() => {
          const decoded = decodeShare(data);
          if (decoded.kind === 'chunk') network.get(to)?.chunk('hop', decoded.chunk);
          else if (decoded.kind === 'message' && decoded.message.from) network.get(to)?.receive('hop', { ...decoded.message, from: decoded.message.from });
        }),
      });
      network.set(self, node);
      return node;
    };
    // The sender hands over a consistent note (announced version = its hash) whatever is asked.
    make('gm', async (ref) => (ref.includes('/') ? { kind: 'image', bytes, version: real, mime: 'image/png' } : { kind: 'note', bytes, version: real }));
    const ana = make('ana', async () => null);
    const settled = async <T>(promise: Promise<T>): Promise<string> => {
      const outcome = promise.then(() => 'ok', (error: { reason: string }) => error.reason);
      await vi.advanceTimersByTimeAsync(0);
      return outcome;
    };
    expect(await settled(ana.pull('gm', ITEM, 'note', real))).toBe('ok');
    expect(await settled(ana.pull('gm', ITEM, 'note', other))).toBe('failed');
    expect(await settled(ana.pull('gm', `${'m'.repeat(22)}/${real}`, 'image'))).toBe('ok');
    expect(await settled(ana.pull('gm', `${'m'.repeat(22)}/${other}`, 'image'))).toBe('failed');
  });
});

/** The GM's host with Ben as a real link and Ana as a script (her device(s) are fed by `say`). */
function relayed(anaDevices = ['da']) {
  const players: SessionPlayer[] = [
    ...anaDevices.map((playerId): SessionPlayer => ({ playerId, name: 'Ana', status: 'admitted', client: 'obsidian', personId: 'ana' })),
    { playerId: 'db', name: 'Ben', status: 'admitted', client: 'obsidian', personId: 'ben' },
  ];
  let handler: SessionHandler | null = null;
  const toAna: ShareMessage[] = [];
  const benLink = new PlayerShareLink({ catalogue: noteCatalogue({}, []), hash: nodeHash });
  const session = {
    use: (next: SessionHandler): (() => void) => { handler = next; return () => { handler = null; }; },
    assetChannel: (playerId: string): ChannelPort => ({
      send: (data) => queueMicrotask(() => {
        if (playerId === 'db') { benLink.receive(data); return; }
        const decoded = decodeShare(data);
        if (decoded.kind === 'message') toAna.push(decoded.message);
      }),
      bufferedAmount: () => 0, onDrain: never(), onClose: () => () => {},
    }),
    getPlayers: (): SessionPlayer[] => players.map((candidate) => ({ ...candidate })),
  };
  const host = new GmShareHost({ session, tableId: TABLE_ID, catalogue: noteCatalogue({}, []), hash: nodeHash });
  host.start();
  const benPlayer = players.find((candidate) => candidate.playerId === 'db')!;
  benLink.connected({ send: (data) => queueMicrotask(() => handler!.onAssetData!(benPlayer, data)), bufferedAmount: () => 0, onDrain: never(), onClose: () => () => {} });
  const ben = benLink.activate({ tableId: TABLE_ID, personId: 'ben' });
  const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); };
  const ana = (playerId = 'da') => players.find((candidate) => candidate.playerId === playerId)!;
  for (const device of anaDevices) handler!.onAdmitted!(ana(device));
  handler!.onAdmitted!(benPlayer);
  return {
    host, ben, toAna, flush, ana, handler: (): SessionHandler => handler!,
    /** Ana's device says `message`; the GM stamps her. */
    say: (message: ShareMessage, device = 'da'): void => handler!.onAssetData!(ana(device), encodeShare(message)),
  };
}

describe('through the GM’s relay', () => {
  /** Ben pulls from Ana; Ana's device `device` starts the transfer with her handle and sends 3 bytes. Resolves to the pull's outcome. */
  async function startedPull(world: ReturnType<typeof relayed>, handle: number, device = 'da') {
    const outcome = world.ben.pull('ana', ITEM, 'note').then(() => 'ok', (error: { reason: string }) => error.reason);
    await world.flush();
    const asked = world.toAna.at(-1);
    const req = asked && 'req' in asked ? asked.req : '';
    world.say({ v: 1, type: 'share-start', to: 'ben', req, handle, size: 10, kind: 'note', version: V }, device);
    await world.flush();
    return { outcome, req };
  }

  it('frees the mapping and tells the sender when Ben’s pull times out', async () => {
    const world = relayed();
    const { outcome } = await startedPull(world, 0x8000_0007);
    expect(world.host.relayMappings()).toBe(1);
    await vi.advanceTimersByTimeAsync(SHARE_LIMITS.stallMs);
    expect(await outcome).toBe('timeout');
    expect(world.host.relayMappings()).toBe(0);
    expect(world.toAna.at(-1)).toMatchObject({ type: 'share-cancel', handle: 0x8000_0007 });
  });

  it('frees the mapping when the sender denies after the start', async () => {
    const world = relayed();
    const { outcome, req } = await startedPull(world, 0x8000_0008);
    world.say({ v: 1, type: 'share-denied', to: 'ben', req, reason: 'not-shared' });
    await world.flush();
    expect(await outcome).toBe('not-shared');
    expect(world.host.relayMappings()).toBe(0);
    expect(world.toAna.at(-1)).toMatchObject({ type: 'share-cancel', handle: 0x8000_0008 });
  });

  it('frees every mapping of a sender whose link is taken over (no onGone fires), so the cap does not lock her out', async () => {
    const world = relayed();
    for (let index = 0; index < SHARE_LIMITS.relayedPerSender; index++) {
      world.say({ v: 1, type: 'share-start', to: 'ben', req: 'r'.repeat(10) + index, handle: 0x8000_0100 + index, size: 10, kind: 'note', version: V });
    }
    expect(world.host.relayMappings()).toBe(SHARE_LIMITS.relayedPerSender);
    // The same device is admitted again on a new link.
    world.handler().onAdmitted!(world.ana());
    expect(world.host.relayMappings()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    world.say({ v: 1, type: 'share-start', to: 'ben', req: 'n'.repeat(11), handle: 0x8000_0200, size: 10, kind: 'note', version: V });
    expect(world.host.relayMappings()).toBe(1);
  });

  it('ends a pull from a device that dropped while another device of the same person stays', async () => {
    const world = relayed(['da', 'da2']);
    const { outcome } = await startedPull(world, 0x8000_0009, 'da2');
    expect(world.host.relayMappings()).toBe(1);
    world.ana('da2').status = 'gone';
    world.handler().onGone!({ ...world.ana('da2') });
    // Her other device stays, so nothing is cancelled at once; the stall ends it, and frees the mapping.
    expect(world.host.relayMappings()).toBe(1);
    await vi.advanceTimersByTimeAsync(SHARE_LIMITS.stallMs);
    expect(await outcome).toBe('timeout');
    expect(world.host.relayMappings()).toBe(0);
  });
});
