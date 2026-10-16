import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { PingRelay } from '../../../src/app/online/tools/PingRelay';
import { PING_LIMITS, PingModel } from '../../../src/app/online/tools/pings';

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
const BEN: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };

describe('pings', () => {
  it('grow and fade as rings, then go', () => {
    const model = new PingModel();
    model.add({ x: 10, y: 20 }, '#ff0000', 0);
    expect(model.frame(100)).toEqual([expect.objectContaining({ x: 10, y: 20, color: '#ff0000' })]);
    expect(model.frame(800).length).toBe(PING_LIMITS.rings);
    expect(model.frame(PING_LIMITS.durationMs)).toEqual([]);
    expect(model.active).toBe(false);
  });

  it("are relayed to the sender's scene with who sent them, shown to the GM, never twice a second over", () => {
    const sent: Array<[string, ControlMessage]> = [];
    let handler: SessionHandler | null = null;
    const show = vi.fn();
    const relay = new PingRelay({
      session: { use: (h: SessionHandler) => { handler = h; return () => undefined; }, send: (id: string, m: ControlMessage) => { sent.push([id, m]); }, getPlayers: () => [ANA, BEN] } as never,
      projection: {
        slotOf: () => ({ sceneId: 's1', lastSent: {}, tab: { viewId: 'v1' } }),
        audience: () => ['p1', 'p2'],
        shownSnapshot: () => ({}),
      } as never,
      show,
    });
    relay.start();
    const ping = (x: number, sceneId = 's1'): void => handler!.onMessage?.(ANA, { v: 1, type: 'map-ping', sceneId, x, y: 5, from: 'forged', color: '#000000' });
    ping(1);
    expect(sent).toEqual([['p2', { v: 1, type: 'map-ping', sceneId: 's1', x: 1, y: 5, from: 'p1', color: expect.stringMatching(/^#/) }]]);
    expect(show).toHaveBeenCalledWith('v1', expect.objectContaining({ x: 1, y: 5 }));
    ping(2, 'other');
    ping(3);
    ping(4);
    expect(sent.map(([, message]) => (message as { x: number }).x)).toEqual([1, 3]);
  });
});
