import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeControl } from '../../../src/app/online/protocol';
import type { PlayerLaser } from '../../../src/app/online/tools/toolMessages';
import { LASER_COLOR_SWATCHES } from '@atlas-vtt/shared/rules';
import { toolsWorld } from './toolsFixtures';
import { HUB_PATHS, onHubPath } from './hubPath';

/** Atlas's laser colour setting in the fake, which the GM's laser takes. */
const GM_COLOR = '#ff0000';

describe.each(HUB_PATHS)('LaserRelay, $atlas', ({ tabs }) => {
  onHubPath(tabs);
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("brings a player's laser to the other players and the GM's view, never back to its sender", async () => {
    const w = toolsWorld();
    w.present();
    const heard: PlayerLaser[] = [];
    const a = await w.join('A');
    await w.join('B', { onLaser: (laser) => heard.push(laser) });
    expect(a.session.sendLaser([{ x: 10, y: 20 }], false)).toBe(true);
    expect(heard).toEqual([{ from: a.playerId, sceneId: w.sceneId(), points: [{ x: 10, y: 20 }], lifted: false, color: LASER_COLOR_SWATCHES[1].value }]);
    expect(w.lasersOf(a)).toEqual([]);
    expect(w.shown()).toEqual([{ from: a.playerId, color: LASER_COLOR_SWATCHES[1].value, points: [{ x: 10, y: 20 }], lifted: false }]);
    w.finish();
  });

  it("relays a player's point times to the other players and the GM's view, and drops times it does not accept", async () => {
    const w = toolsWorld();
    w.present();
    const heard: PlayerLaser[] = [];
    const a = await w.join('A');
    await w.join('B', { onLaser: (laser) => heard.push(laser) });
    a.session.sendLaser([{ x: 1, y: 1 }, { x: 2, y: 2 }], false, [0, 33]);
    expect(heard.at(-1)).toMatchObject({ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], dt: [0, 33] });
    expect(w.shown().at(-1)).toMatchObject({ dt: [0, 33] });
    const count = heard.length;
    a.sendRaw(encodeControl({ v: 1, type: 'laser', sceneId: w.sceneId(), points: [{ x: 1, y: 1 }], lifted: false, dt: [1, 2] }));
    a.sendRaw(encodeControl({ v: 1, type: 'laser', sceneId: w.sceneId(), points: [{ x: 1, y: 1 }], lifted: false, dt: [-5] }));
    expect(heard).toHaveLength(count);
    w.finish();
  });

  it("sends the GM's own laser to every player while the scene is live, and lets it go when the scene is held", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    w.emitLocal({ kind: 'point', x: 1, y: 2 });
    expect(w.lasersOf(a).at(-1)).toEqual({ v: 1, type: 'laser', from: 'gm', sceneId: w.sceneId(), points: [{ x: 1, y: 2 }], lifted: false, dt: [0], color: GM_COLOR });
    w.tabs.getState().setActiveTab(w.dungeon);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.lasersOf(a).at(-1)).toMatchObject({ from: 'gm', points: [], lifted: true });
    const count = w.lasersOf(a).length;
    w.emitLocal({ kind: 'point', x: 5, y: 5 });
    await vi.advanceTimersByTimeAsync(600);
    expect(w.lasersOf(a)).toHaveLength(count);
    w.finish();
  });

  it("relays a player's laser on the held scene to players, but shows none on the GM's other map", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    w.tabs.getState().setActiveTab(w.dungeon);
    a.session.sendLaser([{ x: 3, y: 4 }], false);
    expect(w.lasersOf(b).at(-1)).toMatchObject({ from: a.playerId, points: [{ x: 3, y: 4 }] });
    expect(w.shown()).toEqual([]);
    w.finish();
  });

  it("sends the GM's laser in the colour Atlas has set, and takes a change from the next message", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    w.emitLocal({ kind: 'point', x: 1, y: 1 });
    await vi.advanceTimersByTimeAsync(100);
    w.atlas.setSetting('laserPointer', { color: '#00ff00', size: 3 });
    w.emitLocal({ kind: 'point', x: 2, y: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(w.lasersOf(a).filter((laser) => laser.from === 'gm').map((laser) => laser.color)).toEqual([GM_COLOR, '#00ff00']);
    w.finish();
  });

  it("listens to the GM's laser in the presented view only while the scene is live, and shows players' lasers in that view", async () => {
    const w = toolsWorld();
    expect(w.atlas.lasers.listening(w.view)).toBe(0);
    w.present();
    expect(w.atlas.lasers.listening(w.view)).toBe(1);
    w.tabs.getState().setActiveTab(w.dungeon);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.atlas.lasers.listening(w.view)).toBe(0);
    w.tabs.getState().setActiveTab(w.tavern);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.atlas.lasers.listening(w.view)).toBe(1);
    w.finish();
    expect(w.atlas.lasers.listening(w.view)).toBe(0);
  });

  it("ignores a laser for another scene and a player's claim to be the GM", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    a.sendRaw(encodeControl({ v: 1, type: 'laser', sceneId: 'elsewhere', points: [{ x: 1, y: 1 }], lifted: false }));
    a.sendRaw(encodeControl({ v: 1, type: 'laser', from: 'gm', sceneId: w.sceneId(), points: [{ x: 1, y: 1 }], lifted: false }));
    expect(w.lasersOf(b).map((laser) => laser.from)).toEqual([a.playerId]);
    w.finish();
  });

  it('ignores more than 60 lasers a second from one player', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    for (let i = 0; i < 65; i++) a.session.sendLaser([{ x: i, y: 0 }], false);
    expect(w.lasersOf(b)).toHaveLength(60);
    w.finish();
  });

  it('allows 60 lasers a second, and never limits a lift', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    for (let i = 0; i < 65; i++) a.session.sendLaser([{ x: i, y: 0 }], false);
    expect(w.lasersOf(b)).toHaveLength(60);
    a.session.sendLaser([], true);
    expect(w.lasersOf(b).at(-1)).toMatchObject({ from: a.playerId, lifted: true });
    w.finish();
  });

  it('relays an over-limit lift only for a laser being held, and without points', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    for (let i = 0; i < 60; i++) a.session.sendLaser([{ x: i, y: 0 }], false);
    // Over the limit and holding: the lift goes on, its points do not; then there is nothing to lift.
    a.session.sendLaser([{ x: 9, y: 9 }], true);
    a.session.sendLaser([{ x: 9, y: 9 }], true);
    const sent = w.lasersOf(b);
    expect(sent).toHaveLength(61);
    expect(sent.at(-1)).toMatchObject({ from: a.playerId, points: [], lifted: true });
    // Never held: a flood of lifts carries nothing.
    const c = await w.join('C');
    for (let i = 0; i < 80; i++) c.session.sendLaser([{ x: i, y: 1 }], true);
    expect(w.lasersOf(b).filter((laser) => laser.from === c.playerId)).toHaveLength(60);
    w.finish();
  });

  it("lets a leaving player's laser go for everyone", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    const c = await w.join('C');
    a.session.sendLaser([{ x: 1, y: 1 }], false);
    a.session.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.lasersOf(b).at(-1)).toEqual({ v: 1, type: 'laser', from: a.playerId, sceneId: w.sceneId(), points: [], lifted: true, color: LASER_COLOR_SWATCHES[1].value });
    expect(w.shown().at(-1)).toMatchObject({ from: a.playerId, lifted: true });
    // Removed by the GM mid-stroke: the session's player list no longer has them.
    c.session.sendLaser([{ x: 2, y: 2 }], false);
    w.removePlayer(c);
    expect(w.lasersOf(b).at(-1)).toMatchObject({ from: c.playerId, lifted: true });
    w.finish();
  });
});
