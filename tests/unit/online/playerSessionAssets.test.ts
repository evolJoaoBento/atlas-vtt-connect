import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerSession, RECONNECT_DELAYS_MS } from '../../../src/app/online/PlayerSession';
import { encodeControl } from '../../../src/app/online/protocol';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import type { PeerLink } from '../../../src/app/online/transport/types';

const admitted = encodeControl({ v: 1, type: 'admitted', playerId: 'p1', session: { title: 'Table' } });

describe('PlayerSession assets channel', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('passes the assets channel to its handler only while admitted, and reports every drop', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const gmEnds: PeerLink[] = [];
    host.onConnection((link) => gmEnds.push(link));
    const events: string[] = [];
    const sends: Array<(data: string) => void> = [];
    const player = new PlayerSession({
      hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {},
      assets: {
        connected: (send) => { sends.push(send); events.push('connected'); },
        receive: (data) => events.push(`data:${String(data)}`),
        disconnected: () => events.push('disconnected'),
      },
    });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    const gm = gmEnds[0]!;
    const atGm: Array<[string, unknown]> = [];
    gm.onMessage((channel, data) => atGm.push([channel, data]));

    gm.send('assets', 'before admission');
    expect(events).toEqual([]);
    gm.send('control', admitted);
    expect(events).toEqual(['connected']);
    gm.send('assets', 'chunk');
    sends[0]!('request');
    expect(events).toEqual(['connected', 'data:chunk']);
    expect(atGm).toContainEqual(['assets', 'request']);

    gm.close();
    expect(events).toEqual(['connected', 'data:chunk', 'disconnected']);
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    const again = gmEnds[1]!;
    again.send('control', admitted);
    expect(events.at(-1)).toBe('connected');
    // The old link's `send` goes nowhere; the new one reaches the GM.
    const atGmAgain: unknown[] = [];
    again.onMessage((channel, data) => { if (channel === 'assets') atGmAgain.push(data); });
    sends[0]!('stale');
    sends[1]!('fresh');
    expect(atGmAgain).toEqual(['fresh']);

    player.stop();
    expect(events.at(-1)).toBe('disconnected');
    expect(events.filter((event) => event === 'disconnected')).toHaveLength(2);
  });

  it('announces a link to the handler once, however often the GM admits on it', async () => {
    const network = new MemoryNetwork();
    const gmEnds: PeerLink[] = [];
    network.host('gm').onConnection((link) => gmEnds.push(link));
    const connected = vi.fn();
    const player = new PlayerSession({
      hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {},
      assets: { connected, receive: () => {}, disconnected: () => {} },
    });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    gmEnds[0]!.send('control', admitted);
    gmEnds[0]!.send('control', admitted);
    expect(connected).toHaveBeenCalledTimes(1);
    player.stop();
  });

  it('works without an assets handler', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm');
    const gmEnds: PeerLink[] = [];
    host.onConnection((link) => gmEnds.push(link));
    const player = new PlayerSession({ hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {} });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    gmEnds[0]!.send('control', admitted);
    expect(() => gmEnds[0]!.send('assets', 'chunk')).not.toThrow();
    player.stop();
  });
});
