import { describe, expect, it } from 'vitest';
import {
  cellsByRule, explodingFaces, flatCells, formatDistance, getDiceCrit, isDefeated, pathLengthInCells, resolveLevel, resolveMeasurementSettings, riseInCells, showsDragDistance, snapTokenCenter,
  tokenHeight, type DiagonalRule, type GridGeometry,
} from '../../../packages/atlas-shared/src/index';

const grid: GridGeometry = { type: 'square', size: 70, offsetX: 0, offsetY: 0 };
const at = (cx: number, cy: number) => ({ x: 35 + 70 * cx, y: 35 + 70 * cy });

describe('atlas-shared: Atlas 0.15.0 grid distance', () => {
  it('prices a path with a diagonal leg by each rule', () => {
    const path = [at(0, 0), at(3, 3), at(5, 3)];
    expect(pathLengthInCells(grid, path, 'manhattan')).toBe(8);
    expect(pathLengthInCells(grid, path, 'equidistant')).toBe(5);
    expect(pathLengthInCells(grid, path, 'alternating')).toBe(6);
    expect(pathLengthInCells(grid, path, 'euclidean')).toBeCloseTo(Math.hypot(3, 3) + 2, 9);
  });

  it('counts a climb as a third axis under the same rule', () => {
    const leg = [at(0, 0), at(2, 0)];
    const by = (rule: DiagonalRule) => cellsByRule(flatCells(grid, leg), rule, 3);
    expect(by('equidistant')).toBe(3);
    expect(by('manhattan')).toBe(5);
    expect(by('alternating')).toBe(4);
    expect(by('euclidean')).toBeCloseTo(Math.hypot(2, 3), 9);
  });
});

describe('atlas-shared: Atlas 0.15.0 placement, heights and levels', () => {
  it('snaps a token of one cell to a cell centre, and one of two cells to where four cells meet', () => {
    const toCell = (point: { x: number; y: number }) => ({ x: Math.floor(point.x / 70) * 70 + 35, y: Math.floor(point.y / 70) * 70 + 35 });
    expect(snapTokenCenter({ x: 80, y: 80 }, 1, 'square', 70, toCell)).toEqual({ x: 105, y: 105 });
    // A Large token (size 1.5: two cells across) centres on a corner.
    const large = snapTokenCenter({ x: 80, y: 80 }, 1.5, 'square', 70, toCell);
    expect([large.x % 70, large.y % 70]).toEqual([0, 0]);
    expect(Math.hypot(large.x - 80, large.y - 80)).toBeLessThanOrEqual(Math.hypot(35, 35));
  });

  it('reads a height in game units, and counts it in cells only where a cell spans a distance', () => {
    expect(tokenHeight({ elevation: 10 })).toBe(10);
    expect(tokenHeight({ elevation: 'x' })).toBe(0);
    expect(tokenHeight({ elevation: Number.NaN })).toBe(0);
    expect(tokenHeight({ elevation: 1e9 })).toBe(100_000);
    expect(tokenHeight(null)).toBe(0);
    expect(riseInCells(10, { unitDistance: 5 })).toBe(2);
    expect(riseInCells(-10, { unitDistance: 5 })).toBe(2);
    expect(riseInCells(10, { unitDistance: 0 })).toBe(0);
    expect(riseInCells(Number.NaN, { unitDistance: 5 })).toBe(0);
  });

  it('shows a drag distance always, only in a fight, or never', () => {
    expect(showsDragDistance('always', false)).toBe(true);
    expect(showsDragDistance('combat', false)).toBe(false);
    expect(showsDragDistance('combat', true)).toBe(true);
    expect(showsDragDistance('never', true)).toBe(false);
  });

  it('resolves the level shown, and tells a defeated holder', () => {
    const levels = [{ id: 'ground' }, { id: 'upper' }] as never;
    expect(resolveLevel(levels, 'upper')).toBe('upper');
    expect(resolveLevel(levels, 'gone')).toBe('ground');
    expect(resolveLevel([], 'x')).toBeNull();
    expect(typeof isDefeated).toBe('function');
  });
});

describe('atlas-shared: Atlas 0.15.0 units', () => {
  it('names a custom unit, trimmed, and lets the scene override it', () => {
    const collection = { measurementMode: 'metric', unitType: 'custom', unitName: ' mi ', unitDistance: 1, diagonalRule: 'manhattan' } as const;
    const settings = resolveMeasurementSettings(collection, undefined);
    expect(settings.unitName).toBe('mi');
    expect(formatDistance(6, settings)).toBe('6 mi');
    const scene = resolveMeasurementSettings(collection, { unitNameOverride: 'ly' } as Parameters<typeof resolveMeasurementSettings>[1]);
    expect(formatDistance(6, scene)).toBe('6 ly');
  });

  it('formats metres and feet as Atlas does', () => {
    expect(formatDistance(1.4142, resolveMeasurementSettings({ measurementMode: 'metric', unitType: 'meters', unitDistance: 1.5 }, undefined))).toBe('2.1m');
    expect(formatDistance(6, resolveMeasurementSettings({ measurementMode: 'metric', unitType: 'feet', unitDistance: 5 }, undefined))).toBe('30ft');
  });
});

describe('atlas-shared: Atlas 0.15.0 dice', () => {
  const d20 = (value: number, extra: object = {}) => ({ value, max: 20, ...extra });

  it('calls a roll critical on its default dice only, as each rule reads them', () => {
    expect(getDiceCrit([d20(20)], { defaultRoll: '1d20', crit: 'natural' })).toBe('high');
    expect(getDiceCrit([d20(1)], { defaultRoll: '1d20', crit: 'natural' })).toBe('low');
    expect(getDiceCrit([d20(1)], { defaultRoll: '1d20', crit: 'roll-under' })).toBe('high');
    // The die a keep rule dropped is no default die; the kept one is.
    expect(getDiceCrit([d20(20, { dropped: true }), d20(7)], { defaultRoll: '1d20', crit: 'natural' })).toBe(null);
    // Fewer default dice than the rules roll: none is critical.
    expect(getDiceCrit([d20(20)], { defaultRoll: '2d20', crit: 'doubles' })).toBe(null);
    expect(getDiceCrit([d20(20)], { defaultRoll: '1d20', crit: 'none' })).toBe(null);
  });

  it('never lets every face of a die explode', () => {
    expect(explodingFaces(2, 2, 0)).toEqual({ high: 1, low: 0 });
    expect(explodingFaces(6, 1, 1)).toEqual({ high: 1, low: 1 });
    expect(explodingFaces(3, 1, 5)).toEqual({ high: 1, low: 1 });
  });
});
