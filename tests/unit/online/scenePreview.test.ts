import { describe, expect, it } from 'vitest';
import { sceneWorldBounds } from '../../../src/app/online/preview/previewLayout';
import { MAX_GRID_HEXES, fogShapes, gridLines } from '../../../src/app/online/preview/previewShapes';
import { initiativeLines, playerLines, widgetLines } from '../../../src/app/online/preview/sceneSummary';
import type { PlayerGrid } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene } from './sceneFixtures';

const square: PlayerGrid = {
  type: 'square', size: 100, offsetX: 0, offsetY: 0, color: null, opacity: 0.5,
  lineType: 'dashed', lineWidth: 2, hexNumbers: null, hexNumberOpacity: null,
};

describe('preview layout', () => {
  it('shows the map, else the tokens, else ten cells of grid', () => {
    expect(sceneWorldBounds(playerScene())).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    const noMap = { asset: null, width: 0, height: 0, cellSize: 70 };
    expect(sceneWorldBounds(playerScene({ map: noMap }))).toEqual({ x: -5, y: -5, width: 210, height: 210 });
    expect(sceneWorldBounds(playerScene({ map: noMap, tokens: {} }))).toEqual({ x: 0, y: 0, width: 700, height: 700 });
    expect(sceneWorldBounds(playerScene({ map: noMap, tokens: {}, grid: null }))).toBeNull();
  });
});

describe('preview shapes', () => {
  it('draws square grid lines across the area', () => {
    const lines = gridLines(square, { x: 0, y: 0, width: 300, height: 200 });
    expect(lines?.segments).toHaveLength(7);
    expect(lines).toMatchObject({ hexes: [], color: '#808080', alpha: 0.5, width: 2, dash: [6, 4] });
    expect(gridLines({ ...square, size: 1 }, { x: 0, y: 0, width: 2000, height: 2000 })).toBeNull();
  });

  it('skips hex grids over the cap', () => {
    const hex: PlayerGrid = { ...square, type: 'hex-vertical', size: 1, lineType: 'solid' };
    expect(gridLines(hex, { x: 0, y: 0, width: 5000, height: 5000 })).toBeNull();
    expect(MAX_GRID_HEXES).toBe(5000);
  });

  it('draws hex outlines for hex grids', () => {
    const lines = gridLines({ ...square, type: 'hex-vertical', size: 60, lineType: 'solid' }, { x: 0, y: 0, width: 300, height: 300 });
    expect(lines?.segments).toEqual([]);
    expect(lines?.hexes.length).toBeGreaterThan(10);
    expect(lines?.hexes.every((hex) => hex.length === 6)).toBe(true);
    expect(lines?.dash).toEqual([]);
  });

  it('replays fog in order as strokes, polygons and rectangles', () => {
    const shapes = fogShapes({
      b: { type: 'brush', erase: false, order: 2, radius: 10, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
      c: { type: 'lasso', erase: true, order: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
      a: fogRect(1),
    });
    expect(shapes.map((shape) => shape.kind)).toEqual(['rect', 'stroke', 'polygon']);
    expect(shapes[1]).toMatchObject({ width: 20, erase: false });
    expect(shapes[2]).toMatchObject({ erase: true });
  });
});

describe('scene summary', () => {
  it('lists the players, marking the away ones', () => {
    expect(playerLines([
      { playerId: 'a', name: 'Anna', connected: true },
      { playerId: 'b', name: 'Bob', connected: false },
    ])).toEqual(['Anna', 'Bob (away)']);
  });

  it('lists widgets with their values', () => {
    expect(widgetLines([
      { id: 'a', type: 'counter', label: 'Torches', icon: 'flame', value: 3 },
      { id: 'b', type: 'timer', label: 'Torch', icon: 'hourglass', value: 125 },
      { id: 'c', type: 'clock', label: '', icon: 'clock', value: 2 },
    ])).toEqual(['Torches: 3', 'Torch: 02:05', 'clock: 2']);
  });

  it('lists initiative with the round, the active turn, names and the HP share (the window shows no numbers)', () => {
    const lines = initiativeLines({
      round: 2,
      active: true,
      entries: [
        { id: 'e1', tokenId: 't1', initiative: 18, name: 'Anna', hp: null, hpShare: 0.5, isActive: true },
        { id: 'e2', tokenId: 't2', initiative: 12, name: null, hp: null, isActive: false },
      ],
    });
    expect(lines).toEqual([{ text: 'Round 2' }, { text: '▶ 18 · Anna', share: 0.5 }, { text: '12 · Unnamed' }]);
    // The window draws a bar and no number: no row prints the share
    expect(JSON.stringify(lines.map((line) => line.text))).not.toMatch(/HP|%|0\.5/);
    expect(initiativeLines({ round: 0, active: false, entries: [] })).toEqual([]);
    expect(initiativeLines(null)).toEqual([]);
  });
});
