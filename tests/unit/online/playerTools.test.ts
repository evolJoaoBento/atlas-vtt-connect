import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { LASER_INTERVAL_MS } from '../../../src/app/online/tools/LaserBatcher';
import { TokenMoves } from '../../../src/app/online/view/TokenMoves';
import { PlayerTools } from '../../../src/app/online/view/tools/PlayerTools';
import { ViewInput, type PointerInput } from '../../../src/app/online/view/ViewInput';
import { LASER_PLAYBACK_DELAY_MS } from '@atlas-vtt/shared/draw';
import { LASER_COLOR_SWATCHES, LASER_FADE_TIME } from '@atlas-vtt/shared/rules';
import { playerScene, playerToken } from './sceneFixtures';

/** Screen and world are the same here; t1 sits at (100, 100) on a 70 px square grid. */
function setup(options: { grid?: boolean; tokenSize?: number } = {}) {
  const sent: Array<{ points: ScenePoint[]; lifted: boolean }> = [];
  const moved: Array<[string, number, number]> = [];
  const pans: Array<[number, number]> = [];
  const identity = (point: ScenePoint): ScenePoint => ({ x: point.x, y: point.y });
  const moves = new TokenMoves({
    toWorld: identity,
    send: (tokenId, x, y) => {
      moved.push([tokenId, x, y]);
      return true;
    },
    onChange: () => {},
  });
  const tools = new PlayerTools({
    moves, toWorld: identity, zoom: () => 1, now: () => Date.now(),
    sendLaser: (points, lifted) => {
      sent.push({ points, lifted });
      return true;
    },
    onChange: () => {},
  });
  const scene = playerScene({
    ...(options.grid === false ? { grid: null } : {}),
    ...(options.tokenSize !== undefined ? { tokens: { t1: playerToken({ size: options.tokenSize }) } } : {}),
  });
  moves.setScene(scene);
  moves.setControlled(['t1']);
  moves.setConnected(true);
  tools.setScene(scene);
  tools.setPlayers(['other', 'me'], 'me');
  tools.setConnected(true);
  const input = new ViewInput({ pan: (dx, dy) => { pans.push([dx, dy]); }, zoomAt: () => {} }, tools);
  return { tools, moves, input, sent, moved, pans };
}
const touch = (id: number, x: number, y: number): PointerInput => ({ id, x, y, kind: 'touch', button: 0, time: 0 });

describe('PlayerTools', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('starts on Move; choosing a tool again, or Escape, returns to Move', () => {
    const { tools } = setup();
    expect(tools.tool).toBe('move');
    tools.select('measure');
    expect(tools.tool).toBe('measure');
    tools.select('measure');
    expect(tools.tool).toBe('move');
    tools.select('laser');
    expect(tools.escape()).toBe(true);
    expect(tools.tool).toBe('move');
    expect(tools.escape()).toBe(false);
    tools.selectShape('cone');
    expect([tools.tool, tools.shape]).toEqual(['measure', 'cone']);
  });

  it("measures between snapped cells in the GM's units, privately, and is gone on release", () => {
    const { tools, sent, moved } = setup();
    tools.select('measure');
    expect(tools.grab({ x: 100, y: 100 }, 'mouse')).toBe(true);
    tools.move({ x: 250, y: 100 });
    expect(tools.overlay().measure).toEqual({ shape: 'line', start: { x: 105, y: 105 }, end: { x: 245, y: 105 }, label: '10ft', coneOpening: Math.PI / 2 });
    tools.drop({ x: 250, y: 100 });
    expect(tools.overlay().measure).toBeNull();
    expect(sent).toEqual([]);
    expect(moved).toEqual([]);
  });

  it("opens the measured cone by the GM's cone angle", () => {
    const { tools } = setup();
    tools.setScene(playerScene({ measurement: { ...playerScene().measurement, coneAngle: 60 } }));
    tools.selectShape('cone');
    tools.grab({ x: 100, y: 100 }, 'mouse');
    tools.move({ x: 240, y: 100 });
    expect(tools.overlay().measure?.coneOpening).toBeCloseTo(Math.PI / 3);
  });

  it('measures unsnapped on a square grid of the cell size when the grid is hidden from players', () => {
    const { tools } = setup({ grid: false });
    tools.selectShape('circle');
    tools.grab({ x: 100, y: 100 }, 'mouse');
    tools.move({ x: 240, y: 100 });
    expect(tools.overlay().measure).toEqual({ shape: 'circle', start: { x: 100, y: 100 }, end: { x: 240, y: 100 }, label: '10ft', coneOpening: Math.PI / 2 });
  });

  it("sends the laser in batches, shows it here at once in this player's colour, and fades it after release", () => {
    const { tools, sent } = setup();
    tools.select('laser');
    tools.grab({ x: 10, y: 10 }, 'mouse');
    tools.move({ x: 50, y: 10 });
    expect(sent).toEqual([{ points: [{ x: 10, y: 10 }], lifted: false }]);
    expect(tools.overlay().lasers).toEqual([
      expect.objectContaining({ from: 'self', color: LASER_COLOR_SWATCHES[2].value, head: { x: 50, y: 10 } }),
    ]);
    tools.drop({ x: 50, y: 10 });
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent.at(-1)).toEqual({ points: [{ x: 50, y: 10 }], lifted: true });
    expect(tools.isAnimating()).toBe(true);
    vi.advanceTimersByTime(LASER_FADE_TIME);
    expect(tools.overlay().lasers).toEqual([]);
    expect(tools.isAnimating()).toBe(false);
  });

  it('keeps a laser held still alive for longer than the stale time', () => {
    const { tools } = setup();
    tools.select('laser');
    tools.grab({ x: 10, y: 10 }, 'mouse');
    tools.move({ x: 50, y: 10 });
    vi.advanceTimersByTime(3000);
    expect(tools.overlay().lasers[0]?.head).not.toBeNull();
  });

  it('starts neither measure nor laser while disconnected', () => {
    const { tools, sent } = setup();
    tools.setConnected(false);
    tools.select('laser');
    expect(tools.grab({ x: 10, y: 10 }, 'mouse')).toBe(false);
    tools.select('measure');
    expect(tools.grab({ x: 10, y: 10 }, 'mouse')).toBe(false);
    expect(sent).toEqual([]);
    expect(tools.overlay().lasers).toEqual([]);
  });

  it('lets the laser go when the stroke is interrupted', () => {
    for (const interruption of ['second finger', 'pointercancel', 'tool switch', 'Escape', 'lost connection'] as const) {
      const { tools, input, sent } = setup();
      tools.select('laser');
      input.down(touch(1, 10, 10));
      input.move(touch(1, 60, 10));
      if (interruption === 'second finger') input.down(touch(2, 200, 200));
      if (interruption === 'pointercancel') input.cancel(1);
      if (interruption === 'tool switch') tools.select('measure');
      if (interruption === 'Escape') tools.escape();
      if (interruption === 'lost connection') tools.setConnected(false);
      vi.advanceTimersByTime(LASER_INTERVAL_MS * 2);
      expect(sent.at(-1)?.lifted, interruption).toBe(true);
      expect(tools.overlay().lasers[0]?.head, interruption).toBeNull();
    }
  });

  it("shows other people's lasers for this scene only, in their colours", () => {
    const { tools } = setup();
    tools.receiveLaser({ from: 'other', sceneId: 'scene-1', points: [{ x: 5, y: 5 }], lifted: false });
    tools.receiveLaser({ from: 'gm', sceneId: 'old-scene', points: [{ x: 9, y: 9 }], lifted: false });
    // Played back a moment behind the message.
    expect(tools.overlay().lasers).toEqual([]);
    vi.advanceTimersByTime(LASER_PLAYBACK_DELAY_MS);
    expect(tools.overlay().lasers).toEqual([expect.objectContaining({ from: 'other', color: LASER_COLOR_SWATCHES[1].value })]);
    tools.setScene(playerScene({ sceneId: 'scene-2' }));
    expect(tools.overlay().lasers).toEqual([]);
  });

  it("drags a token with Atlas's drag ruler and adds a waypoint on the waypoint key", () => {
    const { tools, moved } = setup();
    expect(tools.grab({ x: 100, y: 100 }, 'mouse')).toBe(true);
    expect(tools.isDragging()).toBe(true);
    tools.move({ x: 240, y: 100 });
    expect(tools.addWaypoint()).toBe(true);
    tools.move({ x: 240, y: 240 });
    expect(tools.overlay().ruler).toEqual({ points: [{ x: 105, y: 105 }, { x: 245, y: 105 }, { x: 245, y: 245 }], label: '20ft' });
    tools.drop({ x: 240, y: 240 });
    expect(tools.overlay().ruler).toBeNull();
    expect(moved).toEqual([['t1', 240, 240]]);
  });

  it("ends a Large token's ruler where four cells meet, where the GM's drop puts it", () => {
    const { tools } = setup({ tokenSize: 1.5 });
    expect(tools.grab({ x: 100, y: 100 }, 'mouse')).toBe(true);
    tools.move({ x: 240, y: 100 });
    expect(tools.overlay().ruler).toEqual({ points: [{ x: 70, y: 70 }, { x: 210, y: 70 }], label: '10ft' });
  });

  it("with Move, leaves a press off the player's tokens to pan the map", () => {
    const { tools } = setup();
    expect(tools.grab({ x: 600, y: 600 }, 'mouse')).toBe(false);
    expect(tools.addWaypoint()).toBe(false);
  });

  it('pinches and pans the map with two fingers whatever the tool, and drops the measurement', () => {
    const { tools, input, pans } = setup();
    tools.select('measure');
    input.down(touch(1, 100, 100));
    input.move(touch(1, 200, 100));
    expect(tools.overlay().measure).not.toBeNull();
    input.down(touch(2, 300, 300));
    input.move(touch(2, 320, 300));
    expect(tools.overlay().measure).toBeNull();
    expect(pans.length).toBeGreaterThan(0);
  });
});
