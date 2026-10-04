import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeControl } from '../../../src/app/online/protocol';
import { RESYNC_MIN_INTERVAL_MS } from '../../../src/app/online/scene/PlayerSceneMirror';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { controlWorld } from './controlFixtures';

// The fork's world also had the scene broadcaster, so its tests also pinned where the list falls among the
// snapshots, and the dropping of a token deleted from the presented scene; those belong with the broadcaster
// and the control host.
describe('control lists', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends each player their own list when their assignments change, and nobody else', async () => {
    const w = controlWorld();
    const a = await w.join('A');
    const b = await w.join('B');
    w.control.set('hero', a.playerId, true);
    w.control.set('ally', a.playerId, true);
    w.control.set('hero', a.playerId, false);
    expect(a.controlLists()).toEqual([[], ['hero'], ['hero', 'ally'], ['ally']]);
    expect(b.controlLists()).toEqual([[]]);
    w.finish();
  });

  it('sends the list on admission, again with every resync, and after a reconnect with the same key', async () => {
    const w = controlWorld();
    const a = await w.join('A');
    expect(a.controlLists()).toEqual([[]]);
    w.control.set('hero', a.playerId, true);
    a.sendRaw(encodeControl({ v: 1, type: 'scene-resync', seq: 0 }));
    expect(a.controlLists()).toEqual([[], ['hero'], ['hero']]);

    (a.session as unknown as { link: PeerLink }).link.close();
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.session.state.status).toBe('admitted');
    expect(a.session.state.playerId).toBe(a.playerId);
    expect(a.controlLists().at(-1)).toEqual(['hero']);
    w.finish();
  });

  it('holds a second resync back until the throttle interval has passed', async () => {
    const w = controlWorld();
    const a = await w.join('A');
    w.control.set('hero', a.playerId, true);
    a.sendRaw(encodeControl({ v: 1, type: 'scene-resync', seq: 0 }));
    const lists = a.controlLists().length;
    a.sendRaw(encodeControl({ v: 1, type: 'scene-resync', seq: 0 }));
    expect(a.controlLists()).toHaveLength(lists);
    await vi.advanceTimersByTimeAsync(RESYNC_MIN_INTERVAL_MS);
    expect(a.controlLists()).toHaveLength(lists + 1);
    w.finish();
  });

  it('a removed player loses their tokens; one who is only gone keeps them', async () => {
    const w = controlWorld();
    const a = await w.join('A');
    const b = await w.join('B');
    w.control.set('hero', a.playerId, true);
    w.control.set('hero', b.playerId, true);
    (b.session as unknown as { link: PeerLink }).link.close();
    expect(w.gm.getPlayers().find((player) => player.playerId === b.playerId)?.status).toBe('gone');
    w.gm.kick(a.playerId);
    expect(w.control.tokensOf(a.playerId)).toEqual([]);
    expect(w.control.tokensOf(b.playerId)).toEqual(['hero']);
    w.finish();
  });
});
