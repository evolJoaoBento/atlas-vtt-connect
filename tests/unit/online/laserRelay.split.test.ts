import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LASER_INTERVAL_MS } from '../../../src/app/online/tools/LaserBatcher';
import { lastSceneId, splitWorld, tab, VIEW, type RawPlayer, type SplitWorld } from './splitFixtures';
import { lasersOf, sendLaser, toolParts } from './splitParts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Anna and Cy follow the presented Ambush; Ben and Dan are on Bridge, which the GM's view shows. */
async function party(): Promise<{ w: SplitWorld; anna: RawPlayer; cy: RawPlayer; ben: RawPlayer; dan: RawPlayer }> {
  const w = await splitWorld();
  toolParts(w);
  await w.present('a');
  const [anna, cy, ben, dan] = [await w.join('anna'), await w.join('cy'), await w.join('ben'), await w.join('dan')];
  void w.hub.assign(ben.playerId, tab('b'));
  await vi.advanceTimersByTimeAsync(0);
  void w.hub.assign(dan.playerId, tab('b'));
  await vi.advanceTimersByTimeAsync(0);
  return { w, anna, cy, ben, dan };
}

const gmLasers = (player: RawPlayer, from = 0): Array<{ x: number; lifted: boolean }> =>
  lasersOf(player, from).filter((laser) => laser.from === 'gm').map((laser) => ({ x: laser.points[0]?.x ?? -1, lifted: laser.lifted }));

describe('LaserRelay with a split party', () => {
  it('relays a laser only to players on the same scene', async () => {
    const { w, anna, cy, ben, dan } = await party();
    sendLaser(ben, lastSceneId(ben)!, 5);
    expect(lasersOf(dan).map((laser) => [laser.from, laser.sceneId])).toEqual([[ben.playerId, lastSceneId(ben)]]);
    expect([...lasersOf(anna), ...lasersOf(cy)]).toEqual([]);
    expect(w.atlas.lasers.shown(VIEW)).toHaveLength(1);
    // Ambush is parked: its players' lasers reach each other, never Bridge, and never the GM's view.
    sendLaser(anna, lastSceneId(anna)!, 6);
    expect(lasersOf(cy).map((laser) => [laser.from, laser.sceneId])).toEqual([[anna.playerId, lastSceneId(anna)]]);
    expect(lasersOf(dan)).toHaveLength(1);
    expect(lasersOf(ben)).toEqual([]);
    expect(w.atlas.lasers.shown(VIEW)).toHaveLength(1);
  });

  it('drops a laser stamped with another scene\'s id', async () => {
    const { anna, cy, ben, dan } = await party();
    sendLaser(ben, lastSceneId(anna)!, 5);
    expect([...lasersOf(anna), ...lasersOf(cy), ...lasersOf(dan)]).toEqual([]);
  });

  it('the GM\'s laser reaches only the shown scene\'s players', async () => {
    const { w, anna, ben, dan } = await party();
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 7, y: 7 });
    await vi.advanceTimersByTimeAsync(LASER_INTERVAL_MS * 2);
    expect(gmLasers(ben)).toEqual([{ x: 7, lifted: false }]);
    expect(gmLasers(dan)).toEqual([{ x: 7, lifted: false }]);
    expect(gmLasers(anna)).toEqual([]);
  });

  it('the presented scene\'s GM laser never reaches a player on another scene', async () => {
    const { w, anna, cy, ben } = await party();
    await w.switchTo('a');
    const benBefore = ben.received.length;
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 8, y: 8 });
    await vi.advanceTimersByTimeAsync(LASER_INTERVAL_MS * 2);
    expect(gmLasers(anna)).toEqual([{ x: 8, lifted: false }]);
    expect(gmLasers(cy)).toEqual([{ x: 8, lifted: false }]);
    expect(gmLasers(ben, benBefore)).toEqual([]);
  });

  it('the GM\'s laser during a switch reaches neither audience', async () => {
    const { w, anna, ben } = await party();
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 1, y: 1 });
    // Drawn on Bridge, not sent yet: the switch begins.
    const switched = w.atlas.views.switchTab(VIEW, 'a', { loadDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(10);
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 2, y: 2 });
    await vi.advanceTimersByTimeAsync(40);
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 3, y: 3 });
    await vi.advanceTimersByTimeAsync(60);
    await switched;
    await vi.advanceTimersByTimeAsync(LASER_INTERVAL_MS * 2);
    // Ambush's players got nothing drawn while it loaded; Bridge's got at most the lift of what was drawn on it.
    expect(gmLasers(anna)).toEqual([]);
    const benPoints = gmLasers(ben).filter((laser) => !laser.lifted).map((laser) => laser.x);
    expect(benPoints).not.toContain(2);
    expect(benPoints).not.toContain(3);
  });

  it('points drawn on B and still waiting for their batch never reach A once A is shown', async () => {
    const { w, anna, cy, ben } = await party();
    await vi.advanceTimersByTimeAsync(LASER_INTERVAL_MS * 2);
    // The first point goes at once; the second waits out the batch interval.
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 1, y: 1 });
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 2, y: 2 });
    const benBefore = ben.received.length;
    await w.switchTo('a');
    await vi.advanceTimersByTimeAsync(LASER_INTERVAL_MS * 4);
    expect(gmLasers(anna)).toEqual([]);
    expect(gmLasers(cy)).toEqual([]);
    expect(gmLasers(ben, benBefore).filter((laser) => !laser.lifted)).toEqual([]);
  });
});
