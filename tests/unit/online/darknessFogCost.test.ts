import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FogOperation } from '@atlas-vtt/api-types';
import type { Darkness } from '../../../src/app/online/scene/darknessFog';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { createProjectionMemo } from '../../../src/app/online/scene/projectRecords';
import { FogCoverageCache } from '../../../src/app/online/scene/sceneSources';

// The fork's second case counted the draws of Atlas's own fog renderer: it belongs with Atlas's renderer.

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
  it('on the GM: the fog is rasterised once, however often the darkness changes', () => {
    const fog = heavyFog(300);
    const replays = vi.spyOn(FogCoverage, 'fromPlayerFog');
    const cache = new FogCoverageCache();
    const memo = createProjectionMemo();
    const darkness = (x: number): Darkness => ({ fog: {}, covered: [{ x, y: 0, width: 100, height: 800 }] });
    const coverages = [500, 600, 700].map((x) => cache.get(fog, memo, darkness(x)).coverage);
    expect(replays).toHaveBeenCalledTimes(1);
    // Ruling L-POS: the darkness is never painted into the fog's coverage; texts and drawings read the raster itself.
    expect(new Set(coverages).size).toBe(1);
  });
});
