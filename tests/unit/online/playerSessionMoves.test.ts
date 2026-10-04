import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { controlWorld } from './controlFixtures';

// The GM side is a stand-in that takes a move of a controlled token as sent; the snapping of the drop
// belongs to the move handler, which comes with the session service.
describe('PlayerSession token moves', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('hears its control list and refusals, and sends one drop for the scene it has', async () => {
    const w = controlWorld();
    const lists: string[][] = [];
    const refused: string[] = [];
    const a = await w.join('A', { onControl: (ids) => lists.push([...ids]), onMoveRefused: (id) => refused.push(id) });
    w.showScene(a);
    // The empty list on admission changes nothing, so it tells nobody.
    expect(lists).toEqual([]);
    w.control.set('hero', a.playerId, true);
    expect(lists).toEqual([['hero']]);
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(true);
    expect(w.moves).toEqual([{ playerId: a.playerId, tokenId: 'hero', x: 300, y: 150 }]);
    expect(a.session.sendTokenMove('ally', 300, 150)).toBe(true);
    expect(refused).toEqual(['ally']);
    expect(w.moves).toHaveLength(1);
    w.finish();
  });

  it('sends nothing before a scene or while reconnecting, gets its list again after, and forgets it when removed', async () => {
    const w = controlWorld();
    const lists: string[][] = [];
    const a = await w.join('A', { onControl: (ids) => lists.push([...ids]) });
    w.control.set('hero', a.playerId, true);
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(false);
    w.showScene(a);
    (a.session as unknown as { link: PeerLink }).link.close();
    expect(a.session.state.status).toBe('connecting');
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.session.state.status).toBe('admitted');
    expect(lists.at(-1)).toEqual(['hero']);
    w.showScene(a);
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(true);
    w.gm.kick(a.playerId);
    expect(a.session.state.status).toBe('denied');
    expect(lists.at(-1)).toEqual([]);
    expect(a.session.sendTokenMove('hero', 300, 150)).toBe(false);
    w.finish();
  });
});
