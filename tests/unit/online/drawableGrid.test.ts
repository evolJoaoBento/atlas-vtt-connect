import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { UNDRAWABLE_GRID_WARNING } from '../../../src/app/online/playerSessionScene';
import { drawableGridFilter, GRID_DRAW_LIMITS, isDrawableGrid } from '../../../src/app/online/scene/drawableGrid';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import { playerScene, sceneBody } from './sceneFixtures';

// The player-side analog of the final API review's C1: a grid drawers would loop over without end never reaches the
// join page, the Canvas tab or Atlas's remote view; the scene is drawn without a grid.

const MAP = { width: 1000, height: 800 };
const grid = (changes: Record<string, unknown>): PlayerScene['grid'] => ({ ...playerScene().grid!, ...changes } as PlayerScene['grid']);

describe('drawable grid', () => {
  it('drops sizes -1, 0.0001 and NaN, at once and without drawing anything', () => {
    for (const size of [-1, 0.0001, Number.NaN, 0, 1.99, Infinity]) expect(isDrawableGrid(grid({ size }), MAP), String(size)).toBe(false);
    const filter = drawableGridFilter(() => undefined);
    const started = performance.now();
    for (const size of [-1, 0.0001, Number.NaN]) expect(filter(playerScene({ grid: grid({ size }) }))?.grid).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('caps cells per side, against the longer side of the map', () => {
    expect(isDrawableGrid(grid({ size: 2 }), { width: 4000, height: 10 })).toBe(true);
    expect(isDrawableGrid(grid({ size: 2 }), { width: 10, height: 4002 })).toBe(false);
    expect(isDrawableGrid(grid({ size: 1.5 }), { width: 200_000, height: 200_000 })).toBe(false);
    expect(isDrawableGrid(grid({ size: 100 }), { width: 200_000, height: 200_000 })).toBe(true);
    expect(GRID_DRAW_LIMITS).toEqual({ minSize: 2, cellsPerSide: 2000 });
  });

  it('drops unknown types and line styles and non-finite numbers', () => {
    expect(isDrawableGrid(grid({ type: 'triangle' }), MAP)).toBe(false);
    expect(isDrawableGrid(grid({ lineType: 'wavy' }), MAP)).toBe(false);
    for (const field of ['offsetX', 'offsetY', 'lineWidth', 'opacity']) expect(isDrawableGrid(grid({ [field]: Number.NaN }), MAP), field).toBe(false);
    expect(isDrawableGrid(null, MAP)).toBe(false);
    expect(isDrawableGrid(grid({}), MAP)).toBe(true);
    expect(isDrawableGrid(grid({ type: 'hex-vertical' }), MAP)).toBe(true);
  });

  it('keeps a good scene as it is, and gives the same copy for the same bad scene', () => {
    const dropped: unknown[] = [];
    const filter = drawableGridFilter((bad) => dropped.push(bad));
    const good = playerScene();
    expect(filter(good)).toBe(good);
    expect(filter(null)).toBeNull();
    const bad = playerScene({ grid: grid({ size: 1 }), map: { asset: null, width: 100_000, height: 100 } as PlayerScene['map'] });
    expect(filter(bad)).toBe(filter(bad));
    expect(filter(bad)).toEqual({ ...bad, grid: null });
    expect(dropped).toHaveLength(1);
  });
});

describe('a player session', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('passes no 1 px grid over a 10,000 px map to its scene listeners, and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const network = new MemoryNetwork();
    const requests: SessionPlayer[] = [];
    const gm = new GmSession(network.host('gm'), { title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {} });
    gm.start();
    const scenes: Array<PlayerScene | null> = [];
    const player = new PlayerSession({
      hostId: 'gm', name: 'Anna', playerKey: 'key-a', clientVersion: '1', transport: network.client(), onChange: () => {}, onScene: (scene) => scenes.push(scene),
    });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    gm.allow(requests[0]!.playerId);
    // Valid on the wire: sizes from 1 px and maps to 200,000 px pass the validator.
    const scene = playerScene({ map: { asset: 'map-asset', width: 10_000, height: 10_000, cellSize: 1 }, grid: grid({ size: 1 }), fog: {}, drawings: {} });
    for (const seq of [1, 2]) gm.send(requests[0]!.playerId, { v: 1, type: 'scene-snapshot', seq, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    expect(scenes.at(-1)?.tokens).toEqual(scene.tokens);
    expect(scenes.filter((received) => received?.grid)).toEqual([]);
    expect(player.scene?.grid).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(UNDRAWABLE_GRID_WARNING, expect.objectContaining({ size: 1 }));
  });
});
