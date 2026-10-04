import { describe, expect, it } from 'vitest';
import type { FogBrushStroke, FogLassoFill, FogOperation, FogRectangleFill } from '@atlas-vtt/api-types';
import { finiteOr, finiteOrNull, oneOf, positiveOr, positiveOrNull, textOr, textOrNull, unitOr } from '../../../src/app/online/scene/coerce';
import { FOG_CELL_SIZE, FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { SCENE_LIMITS, SCENE_RANGES } from '../../../src/app/online/scene/sceneLimits';
import { simplifyPoints, wirePoints } from '../../../src/app/online/scene/simplifyPoints';
import { coverageOfFog } from './sceneFixtures';

let clock = 1;
const next = (): number => clock++;

function rect(x: number, y: number, width: number, height: number, extra: Partial<FogRectangleFill> = {}): FogRectangleFill {
  const timestamp = next();
  return { id: `r${timestamp}`, kind: 'fog', type: 'rectangle', timestamp, isErasing: false, x, y, width, height, ...extra };
}
function brush(points: Array<{ x: number; y: number }>, brushRadius: number, extra: Partial<FogBrushStroke> = {}): FogBrushStroke {
  const timestamp = next();
  return { id: `b${timestamp}`, kind: 'fog', type: 'brush', timestamp, isErasing: false, points, brushRadius, ...extra };
}
function lasso(points: Array<{ x: number; y: number }>, extra: Partial<FogLassoFill> = {}): FogLassoFill {
  const timestamp = next();
  return { id: `l${timestamp}`, kind: 'fog', type: 'lasso', timestamp, isErasing: false, points, ...extra };
}
const coverageOf = (...ops: FogOperation[]): FogCoverage =>
  coverageOfFog(Object.fromEntries(ops.map((op) => [op.id, op])));
const box = (x: number, y: number, width: number, height: number): { x: number; y: number; width: number; height: number } =>
  ({ x, y, width, height });

describe('coerce', () => {
  it('reads numbers, numeric strings and fallbacks', () => {
    expect(finiteOr('5', 0)).toBe(5);
    expect(finiteOr('lots', 0)).toBe(0);
    expect(finiteOr(Number.NaN, 7)).toBe(7);
    expect(positiveOr(-1, 70)).toBe(70);
    expect(unitOr(3, 1)).toBe(1);
    expect(textOr(5, 'none')).toBe('none');
    expect(textOr('x'.repeat(600), '')).toHaveLength(SCENE_LIMITS.stringLength);
    expect(textOrNull('')).toBeNull();
    expect(oneOf(['a', 'b'] as const, 'c', 'a')).toBe('a');
  });

  it('clamps wire numbers into the player validator ranges', () => {
    expect(finiteOr(1e12, 0, SCENE_RANGES.coordinate)).toBe(SCENE_RANGES.coordinate[1]);
    expect(finiteOr('x', 0, SCENE_RANGES.gridSize)).toBe(SCENE_RANGES.gridSize[0]);
    expect(positiveOr(0.001, 1, SCENE_RANGES.tokenSize)).toBe(SCENE_RANGES.tokenSize[0]);
    expect(positiveOr(-1, 1e9, SCENE_RANGES.mapSize)).toBe(SCENE_RANGES.mapSize[1]);
    expect(finiteOrNull(1e12, SCENE_RANGES.stroke)).toBe(SCENE_RANGES.stroke[1]);
    expect(positiveOrNull(1e6, SCENE_RANGES.fontSize)).toBe(SCENE_RANGES.fontSize[1]);
    expect(finiteOrNull('x', SCENE_RANGES.stroke)).toBeNull();
    expect(finiteOr('x', Number.NaN, SCENE_RANGES.gridSize)).toBe(SCENE_RANGES.gridSize[0]);
  });
});

describe('simplifyPoints', () => {
  it('drops points within the tolerance and keeps corners', () => {
    const line = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyPoints(line, 1)).toEqual([{ x: 0, y: 0 }, { x: 99, y: 0 }]);
    const corner = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }];
    expect(simplifyPoints(corner, 1)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    const shaky = [{ x: 0, y: 0 }, { x: 10, y: 0.4 }, { x: 20, y: -0.4 }, { x: 30, y: 0 }];
    expect(simplifyPoints(shaky, 1)).toHaveLength(2);
    const bumpy = [{ x: 0, y: 0 }, { x: 10, y: 3 }, { x: 20, y: 0 }];
    expect(simplifyPoints(bumpy, 1)).toHaveLength(3);
  });

  it('prepares points for the wire: finite, offset, rounded and bounded', () => {
    expect(wirePoints([{ x: 1.234, y: 2 }, null, { x: Number.NaN, y: 1 }, { x: 5.55, y: 'a' }], 10, 0))
      .toEqual([{ x: 11.2, y: 2 }]);
    expect(wirePoints('not points')).toEqual([]);
    expect(wirePoints([{ x: 5e7, y: -5e7 }, { x: 0, y: 0 }])).toEqual([
      { x: SCENE_RANGES.coordinate[1], y: SCENE_RANGES.coordinate[0] }, { x: 0, y: 0 },
    ]);
    const zigzag = Array.from({ length: 6000 }, (_, i) => ({ x: i, y: (i % 2) * 3 }));
    const sent = wirePoints(zigzag);
    expect(sent.length).toBeLessThanOrEqual(SCENE_LIMITS.points);
    expect(sent.length).toBeGreaterThanOrEqual(2);
  });
});

describe('FogCoverage', () => {
  it('covers nothing without fog, or with erasing only', () => {
    expect(coverageOfFog({}).isCovered(box(0, 0, 10, 10))).toBe(false);
    expect(coverageOf(rect(0, 0, 100, 100, { isErasing: true })).isCovered(box(10, 10, 10, 10))).toBe(false);
  });

  it('covers what lies wholly inside a painted rectangle, not what peeks out', () => {
    const coverage = coverageOf(rect(0, 0, 400, 400));
    expect(coverage.isCovered(box(100, 100, 70, 70))).toBe(true);
    expect(coverage.isCovered(box(360, 100, 70, 70))).toBe(false);
    expect(coverage.isCovered(box(-20, 100, 70, 70))).toBe(false);
  });

  it('covers along a brush stroke within its radius', () => {
    const coverage = coverageOf(brush([{ x: 0, y: 100 }, { x: 400, y: 100 }], 50));
    expect(coverage.isCovered(box(50, 80, 300, 40))).toBe(true);
    expect(coverage.isCovered(box(50, 52, 20, 20))).toBe(false);
    const dab = coverageOf(brush([{ x: 200, y: 200 }], 40));
    expect(dab.isCovered(box(190, 190, 20, 20))).toBe(true);
    expect(dab.isCovered(box(165, 165, 20, 20))).toBe(false);
  });

  it('fills lassos by their inside, including concave ones', () => {
    const square = coverageOf(lasso([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }]));
    expect(square.isCovered(box(20, 20, 100, 100))).toBe(true);
    expect(square.isCovered(box(150, 150, 100, 100))).toBe(false);
    const u = coverageOf(lasso([
      { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 200, y: 300 },
      { x: 200, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 300 }, { x: 0, y: 300 },
    ]));
    expect(u.isCovered(box(120, 150, 60, 60))).toBe(false);
    expect(u.isCovered(box(20, 150, 60, 60))).toBe(true);
  });

  it('replays erases in timestamp order', () => {
    const erased = coverageOf(rect(0, 0, 400, 400), rect(100, 100, 100, 100, { isErasing: true }));
    expect(erased.isCovered(box(120, 120, 50, 50))).toBe(false);
    expect(erased.isCovered(box(300, 300, 50, 50))).toBe(true);
    const paintedLater = coverageOf(
      rect(100, 100, 100, 100, { isErasing: true, timestamp: 1, id: 'erase' }),
      rect(0, 0, 400, 400, { timestamp: 2, id: 'paint' }),
    );
    expect(paintedLater.isCovered(box(120, 120, 50, 50))).toBe(true);
  });

  it('breaks timestamp ties by id', () => {
    const coverage = coverageOf(
      rect(0, 0, 400, 400, { isErasing: true, timestamp: 5, id: 'b' }),
      rect(0, 0, 400, 400, { timestamp: 5, id: 'a' }),
    );
    expect(coverage.isCovered(box(100, 100, 50, 50))).toBe(false);
  });

  it('clears every cell an erase touches', () => {
    const coverage = coverageOf(rect(0, 0, 400, 400), brush([{ x: 200, y: 200 }], 3, { isErasing: true }));
    expect(coverage.isCovered(box(196, 196, 8, 8))).toBe(false);
    expect(coverage.isCovered(box(100, 100, 40, 40))).toBe(true);
  });

  it('applies drag offsets', () => {
    const coverage = coverageOf(rect(0, 0, 100, 100, { offsetX: 500, offsetY: 0 }));
    expect(coverage.isCovered(box(520, 20, 50, 50))).toBe(true);
    expect(coverage.isCovered(box(20, 20, 50, 50))).toBe(false);
  });

  it('coarsens its cells for a huge fogged area', () => {
    const coverage = coverageOf(rect(0, 0, 100_000, 100_000));
    expect(coverage.cellSize).toBeGreaterThan(FOG_CELL_SIZE);
    expect(coverage.isCovered(box(50_000, 50_000, 100, 100))).toBe(true);
  });

  it('ignores operations with broken geometry', () => {
    const broken = rect(Number.NaN, 0, 100, 100);
    const coverage = coverageOf(broken, rect(0, 0, 200, 200));
    expect(coverage.isCovered(box(50, 50, 50, 50))).toBe(true);
  });

  it('erases with far-away lasso points without stretching the grid', () => {
    const coverage = coverageOf(
      rect(0, 0, 400, 400),
      lasso([{ x: 200, y: -1e12 }, { x: 1e12, y: 1e12 }, { x: -1e12, y: 1e12 }], { isErasing: true }),
    );
    // Only painting sets the extent, so the erase's far points cost no extra cells.
    expect(coverage.cellSize).toBe(FOG_CELL_SIZE);
    expect(coverage.isCovered(box(100, 100, 50, 50))).toBe(false);
    const outside = coverageOf(
      rect(0, 0, 400, 400),
      lasso([{ x: 1e9, y: 1e9 }, { x: 2e9, y: 1e9 }, { x: 2e9, y: 2e9 }], { isErasing: true }),
    );
    expect(outside.isCovered(box(100, 100, 50, 50))).toBe(true);
  }, 5_000);

  it('handles a huge brush with many points correctly', () => {
    const points = Array.from({ length: 3000 }, (_, i) => ({ x: (i * 37) % 10_000, y: (i * 91) % 2_000 }));
    const erased = coverageOf(rect(0, 0, 10_000, 2_000), brush(points, 1e6, { isErasing: true }));
    const painted = coverageOf(brush(points, 1e6));
    // A huge brush coarsens the cells, which bounds the replay time whatever the points do.
    expect(painted.cellSize).toBeGreaterThan(FOG_CELL_SIZE);
    // A huge erase brush coarsens them too: erasing stays conservative at any cell size.
    expect(erased.cellSize).toBeGreaterThan(FOG_CELL_SIZE);
    expect(coverageOf(brush(points, 100)).cellSize).toBe(FOG_CELL_SIZE);
    expect(erased.isCovered(box(100, 100, 50, 50))).toBe(false);
    expect(painted.isCovered(box(100, 100, 50, 50))).toBe(true);
    const far = coverageOf(rect(0, 0, 400, 400), brush([{ x: 5e6, y: 5e6 }, { x: 6e6, y: 5e6 }], 50, { isErasing: true }));
    expect(far.isCovered(box(100, 100, 50, 50))).toBe(true);
  }, 5_000);

  it('keeps simplified brush strokes conservative', () => {
    const wobble = Array.from({ length: 200 }, (_, i) => ({ x: i * 2, y: 100 + (i % 2) * 0.5 }));
    const painted = coverageOf(brush(wobble, 20));
    expect(painted.isCovered(box(40, 90, 300, 20))).toBe(true);
    expect(painted.isCovered(box(40, 70, 300, 20))).toBe(false);
  });
});
