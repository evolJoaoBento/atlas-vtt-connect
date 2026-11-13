import { describe, expect, it } from 'vitest';
import { cellsByRule, flatCells, formatDistance, pathLengthInCells, resolveMeasurementSettings, type DiagonalRule, type GridGeometry } from '../../../packages/atlas-shared/src/index';

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
