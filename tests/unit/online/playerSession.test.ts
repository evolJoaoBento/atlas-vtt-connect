import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession, RECONNECT_GIVE_UP_MS, type PlayerSessionState } from '../../../src/app/online/PlayerSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';

function setup() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  const states: PlayerSessionState[] = [];
  const player = new PlayerSession({
    hostId: 'gm', name: 'Anna', playerKey: 'key-a', clientVersion: '0.5.0',
    transport: network.client(), onChange: (s) => states.push({ ...s }),
  });
  return { network, gm, requests, player, states, statuses: () => states.map((s) => s.status) };
}

const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); };

describe('PlayerSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('connects, waits, then is admitted with the player list', async () => {
    const { gm, requests, player, statuses, states } = setup();
    player.start();
    await flush();
    expect(statuses()).toEqual(['connecting', 'waiting']);
    gm.allow(requests[0]!.playerId);
    expect(player.state.status).toBe('admitted');
    expect(states.at(-1)).toMatchObject({ title: 'Vault', players: [{ name: 'Anna', connected: true }] });
  });

  it('stays denied and does not retry', async () => {
    const { gm, requests, player } = setup();
    player.start();
    await flush();
    gm.deny(requests[0]!.playerId);
    expect(player.state).toMatchObject({ status: 'denied', reason: 'denied' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(player.state.status).toBe('denied');
  });

  it('reconnects after a drop without asking the GM again', async () => {
    const { gm, requests, player } = setup();
    player.start();
    await flush();
    gm.allow(requests[0]!.playerId);
    // Drop the player's link from the GM side.
    const gmLinks = (gm as unknown as { links: Map<unknown, unknown> }).links;
    ([...gmLinks.keys()][0] as { close(): void }).close();
    expect(player.state.status).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.state.status).toBe('admitted');
    expect(requests).toHaveLength(1);
  });

  it('stops when the GM ends the session', async () => {
    const { gm, requests, player } = setup();
    player.start();
    await flush();
    gm.allow(requests[0]!.playerId);
    gm.stop(); // host gone: every reconnect fails
    expect(player.state).toMatchObject({ status: 'lost', reason: 'ended' });
  });

  it('reports an unreachable GM', async () => {
    const network = new MemoryNetwork();
    const player = new PlayerSession({
      hostId: 'nobody', name: 'Anna', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {},
    });
    player.start();
    await flush();
    expect(player.state).toMatchObject({ status: 'lost', reason: 'unreachable' });
  });

  it('keeps retrying a dropped link until the give-up time', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const gm = new GmSession(host, { title: 'V', onJoinRequest: (p) => gm.allow(p.playerId), onRequestClosed: () => {}, onPlayersChanged: () => {} });
    gm.start();
    const player = new PlayerSession({ hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {} });
    player.start();
    await flush();
    expect(player.state.status).toBe('admitted');
    host.close(); // unreachable from now on, but no bye was sent
    await vi.advanceTimersByTimeAsync(RECONNECT_GIVE_UP_MS - 1000);
    expect(player.state.status).toBe('connecting');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(player.state).toMatchObject({ status: 'lost', reason: 'connection-lost' });
  });

  describe('with a hand-written transport', () => {
    class FakeLink implements PeerLink {
      readonly remoteId = 'gm';
      sent: ControlMessage[] = [];
      private messageCb: ((c: 'control' | 'assets', d: unknown) => void) | null = null;
      private closeCb: (() => void) | null = null;
      send(_c: 'control' | 'assets', data: string | ArrayBuffer): void {
        const d = decodeControl(data);
        if (d.kind === 'message') this.sent.push(d.message);
      }
      onMessage(cb: (c: 'control' | 'assets', d: unknown) => void): () => void { this.messageCb = cb; return () => {}; }
      onClose(cb: () => void): () => void { this.closeCb = cb; return () => {}; }
      bufferedAmount(): number { return 0; }
      onDrain(): () => void { return () => {}; }
      close(): void {}
      receive(m: ControlMessage): void { this.messageCb?.('control', encodeControl(m)); }
      drop(): void { this.closeCb?.(); }
    }

    function fake() {
      const links: FakeLink[] = [];
      const state = { calls: 0, fail: false };
      const transport: ClientTransport = {
        connect: () => {
          state.calls++;
          if (state.fail) return Promise.reject(new Error('down'));
          const link = new FakeLink();
          links.push(link);
          return Promise.resolve(link);
        },
      };
      const changes: PlayerSessionState[] = [];
      const player = new PlayerSession({
        hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport, onChange: (s) => changes.push({ ...s }),
      });
      const admit = (link: FakeLink): void => link.receive({ v: 1, type: 'admitted', playerId: 'p1', session: { title: 'T' } });
      return { links, state, player, changes, admit };
    }

    it('does not retry after being denied and ignores a late bye', async () => {
      const { links, state, player } = fake();
      player.start();
      await flush();
      links[0]!.receive({ v: 1, type: 'denied', reason: 'denied' });
      links[0]!.receive({ v: 1, type: 'bye', reason: 'ended' });
      links[0]!.drop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(player.state).toMatchObject({ status: 'denied', reason: 'denied' });
      expect(state.calls).toBe(1);
    });

    it('tells a drop before admission (unreachable) from a lost connection after it', async () => {
      const before = fake();
      before.player.start();
      await flush();
      before.links[0]!.drop();
      expect(before.player.state).toMatchObject({ status: 'lost', reason: 'unreachable' });
      expect(before.state.calls).toBe(1);

      const after = fake();
      after.player.start();
      await flush();
      after.admit(after.links[0]!);
      after.state.fail = true;
      after.links[0]!.drop();
      await vi.advanceTimersByTimeAsync(RECONNECT_GIVE_UP_MS + 20_000);
      expect(after.player.state).toMatchObject({ status: 'lost', reason: 'connection-lost' });
    });

    it('ignores messages after stop() and says goodbye', async () => {
      const { links, player, changes, admit } = fake();
      player.start();
      await flush();
      admit(links[0]!);
      player.stop();
      const count = changes.length;
      links[0]!.receive({ v: 1, type: 'presence', players: [] });
      expect(changes).toHaveLength(count);
      expect(links[0]!.sent.at(-1)).toEqual({ v: 1, type: 'bye', reason: 'left' });
    });

    it('is lost/replaced when a newer tab takes over', async () => {
      const { links, player, admit } = fake();
      player.start();
      await flush();
      admit(links[0]!);
      links[0]!.receive({ v: 1, type: 'bye', reason: 'replaced' });
      expect(player.state).toMatchObject({ status: 'lost', reason: 'replaced' });
    });

    it('answers ping with pong carrying the same t', async () => {
      const { links, player } = fake();
      player.start();
      await flush();
      links[0]!.receive({ v: 1, type: 'ping', t: 42 });
      expect(links[0]!.sent.at(-1)).toEqual({ v: 1, type: 'pong', t: 42 });
    });

    it('start() twice connects once', async () => {
      const { state, player } = fake();
      player.start();
      player.start();
      await flush();
      expect(state.calls).toBe(1);
    });

    it('reconnects at 1, 2, 4, 8, 15, 15 s and stays connecting (never waiting)', async () => {
      const { links, state, player, changes, admit } = fake();
      player.start();
      await flush();
      admit(links[0]!);
      state.fail = true;
      const before = changes.length;
      links[0]!.drop();
      expect(state.calls).toBe(1);
      let elapsed = 0;
      let calls = 1;
      for (const step of [1000, 2000, 4000, 8000, 15000, 15000]) {
        await vi.advanceTimersByTimeAsync(step - 1);
        expect(state.calls).toBe(calls);
        await vi.advanceTimersByTimeAsync(1);
        calls++;
        expect(state.calls).toBe(calls);
        elapsed += step;
      }
      expect(elapsed).toBe(45_000);
      expect(changes.slice(before).map((c) => c.status)).not.toContain('waiting');
    });

    it('stop() during a pending retry cancels it', async () => {
      const { links, state, player, admit } = fake();
      player.start();
      await flush();
      admit(links[0]!);
      state.fail = true;
      links[0]!.drop();
      player.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(state.calls).toBe(1);
    });
  });
});
