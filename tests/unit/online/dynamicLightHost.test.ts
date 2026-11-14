import { describe, expect, it, vi } from 'vitest';
import { DynamicLightHost } from '../../../src/app/online/scene/DynamicLightHost';
import type { ControlMessage } from '../../../src/app/online/protocol';
import type { SessionPlayer } from '../../../src/app/online/GmSession';

describe('session-wide dynamic light switch', () => {
  it('applies one player request to every live scene and broadcasts the same state', () => {
    const setDynamicLights = vi.fn();
    const send = vi.fn();
    const players = [{ playerId: 'a', status: 'admitted' }, { playerId: 'b', status: 'admitted' }] as SessionPlayer[];
    const host = new DynamicLightHost({
      session: { use: () => () => undefined, send, getPlayers: () => players } as never,
      projection: { slotOf: () => null, onSlotChange: () => () => undefined, lightSlots: () => [{ sceneId: 'scene', setDynamicLights }] },
    });
    host.start();
    host.onMessage(players[1]!, { v: 1, type: 'dynamic-light-toggle', enabled: false } as ControlMessage);
    expect(setDynamicLights).toHaveBeenLastCalledWith(false);
    expect(send).toHaveBeenCalledWith('a', { v: 1, type: 'dynamic-light-state', enabled: false });
    expect(send).toHaveBeenCalledWith('b', { v: 1, type: 'dynamic-light-state', enabled: false });
    host.stop();
  });
});
