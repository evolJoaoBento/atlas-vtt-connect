import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FogOperation } from '@atlas-vtt/api-types';
import type { Darkness } from '../../../src/app/online/scene/darknessFog';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { createProjectionMemo, projectFog } from '../../../src/app/online/scene/projectRecords';

// The fork's second case counted the draws of Atlas's own fog renderer, and its first went through the
// session's coverage cache; both belong with the code they measure (Atlas's renderer, the broadcaster's
// sources). This pins the cost the projection depends on: a darkness is painted over the fog's cells.

/** `count` GM brush strokes and as many erases, a heavily fogged scene. */
function heavyFog(count: number): Record<string, FogOperation> {
  const fog: Record<string, FogOperation> = {};
  for (let i = 0; i < count; i++) {
    fog[`p${i}`] = { id: `p${i}`, kind: 'fog', type: 'brush', timestamp: 10 + 2 * i, isErasing: false, brushRadius: 20, points: [{ x: 10 * i, y: 50 }, { x: 10 * i + 40, y: 90 }] };
    fog[`e${i}`] = { id: `e${i}`, kind: 'fog', type: 'rectangle', timestamp: 11 + 2 * i, isErasing: true, x: 10 * i, y: 60, width: 5, height: 5 };
  }
  return fog;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('a darkness change costs the same however much fog the GM painted', () => {
  it('the fog is rasterised once, then each darkness is painted over its cells', () => {
    const fog = heavyFog(300);
    const replays = vi.spyOn(FogCoverage, 'fromPlayerFog');
    const playerFog = projectFog(fog, createProjectionMemo());
    const coverage = FogCoverage.fromPlayerFog(playerFog);
    const darkness = (x: number): Darkness => ({ fog: {}, covered: [{ x, y: 0, width: 100, height: 800 }] });
    for (const x of [500, 600, 700]) coverage.covering(darkness(x).covered);
    expect(replays).toHaveBeenCalledTimes(1);
    // The darkness painted over the cells covers what painting it after the operations covers.
    const covered = coverage.covering(darkness(700).covered);
    const replayed = FogCoverage.fromPlayerFog(playerFog, darkness(700).covered);
    for (let x = 0; x < 3200; x += 8) {
      for (let y = 0; y < 800; y += 8) {
        const cell = { x, y, width: 8, height: 8 };
        if (covered.isCovered(cell) !== replayed.isCovered(cell)) throw new Error(`differs at ${x},${y}`);
      }
    }
  });
});
