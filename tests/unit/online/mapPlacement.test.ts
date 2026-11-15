import { describe, expect, it } from 'vitest';
import { effectiveAlignment, mapMatrix, readStretch, type MapAlignment } from '../../../src/app/online/scene/mapPlacement';

/** Atlas 0.10.2's `$4` and `xH`, copied as they are, to check the matrix against: where an image point lands in the world. */
function box(width: number, height: number, stretch: MapAlignment) {
  const turn = ((stretch.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const rect = { width: width * Math.abs(cos) + height * Math.abs(sin), height: width * Math.abs(sin) + height * Math.abs(cos) };
  return { cos, sin, box: rect, corner: { x: (width - rect.width) / 2, y: (height - rect.height) / 2 } };
}
function atlasWorldPoint(point: { x: number; y: number }, image: { width: number; height: number }, stretch: MapAlignment): { x: number; y: number } {
  const { cos, sin, corner } = box(image.width, image.height, stretch);
  const r = point.x - image.width / 2;
  const a = point.y - image.height / 2;
  return {
    x: (image.width / 2 - corner.x + cos * r + sin * a) * stretch.x + (stretch.offset?.x ?? 0),
    y: (image.height / 2 - corner.y - sin * r + cos * a) * stretch.y + (stretch.offset?.y ?? 0),
  };
}
/** Atlas's `oxe`: the world rect of an image. */
function atlasWorldRect(image: { width: number; height: number }, stretch: MapAlignment): { width: number; height: number } {
  const { box: rect } = box(image.width, image.height, stretch);
  return { width: (stretch.offset?.x ?? 0) + rect.width * stretch.x, height: (stretch.offset?.y ?? 0) + rect.height * stretch.y };
}
const through = (matrix: readonly number[], u: number, v: number) => ({ x: matrix[0]! * u + matrix[2]! * v + matrix[4]!, y: matrix[1]! * u + matrix[3]! * v + matrix[5]! });

describe('the map image placed as Atlas places it', () => {
  const IMAGE = { width: 3000, height: 2000 };

  it.each([
    ['a turn', { x: 1, y: 1, rotation: 3 }],
    ['a turn the other way, with a stretch', { x: 1.2, y: 1.1, rotation: -4.5 }],
    ['a level offset, no turn', { x: 1, y: 1, offset: { x: 120, y: 80 } }],
    ['a stretch, a turn and an offset', { x: 1.3, y: 1.05, rotation: 2, offset: { x: 50, y: 300 } }],
  ] as Array<[string, MapAlignment]>)('puts every point of the image where Atlas does: %s', (_name, alignment) => {
    const world = atlasWorldRect(IMAGE, alignment);
    const matrix = mapMatrix(alignment, world)!;
    expect(matrix).not.toBeNull();
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.25, 0.8]] as const) {
      const expected = atlasWorldPoint({ x: u * IMAGE.width, y: v * IMAGE.height }, IMAGE, alignment);
      const got = through(matrix, u, v);
      expect(got.x).toBeCloseTo(expected.x, 6);
      expect(got.y).toBeCloseTo(expected.y, 6);
    }
  });

  it('keeps the whole image inside the world rect it is sent with, its centre at the middle of its box', () => {
    const alignment: MapAlignment = { x: 1.1, y: 1, rotation: 5, offset: { x: 40, y: 60 } };
    const world = atlasWorldRect(IMAGE, alignment);
    const matrix = mapMatrix(alignment, world)!;
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const { x, y } = through(matrix, u, v);
      expect(x).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(x).toBeLessThanOrEqual(world.width + 1e-6);
      expect(y).toBeGreaterThanOrEqual(60 - 1e-6);
      expect(y).toBeLessThanOrEqual(world.height + 1e-6);
    }
    const centre = through(matrix, 0.5, 0.5);
    expect(centre.x).toBeCloseTo(40 + (world.width - 40) / 2, 6);
    expect(centre.y).toBeCloseTo(60 + (world.height - 60) / 2, 6);
  });

  it('sends nothing for a map that only fills its world rect: no alignment, or a stretch alone', () => {
    expect(mapMatrix(null, { width: 3000, height: 2000 })).toBeNull();
    expect(mapMatrix({ x: 1.2, y: 1.1 }, { width: 3600, height: 2200 })).toBeNull();
    expect(mapMatrix({ x: 1, y: 1, rotation: 3 }, { width: 0, height: 0 })).toBeNull();
  });

  it('sends nothing when the world rect cannot belong to the alignment', () => {
    // An offset larger than the world, or a rect too small for the turned image's box.
    expect(mapMatrix({ x: 1, y: 1, offset: { x: 5000, y: 0 } }, { width: 3000, height: 2000 })).toBeNull();
    expect(mapMatrix({ x: 1, y: 1, rotation: 5 }, { width: 10, height: 2000 })).toBeNull();
  });
});

describe("the alignment as Atlas reads it", () => {
  it("takes a grid's stretch only in Atlas's range, and as nothing otherwise", () => {
    expect(readStretch({ x: 1.2, y: 1.1 })).toEqual({ x: 1.2, y: 1.1 });
    expect(readStretch({ x: 1, y: 1.3, rotation: -4 })).toEqual({ x: 1, y: 1.3, rotation: -4 });
    expect(readStretch({ x: 1, y: 1, rotation: 2 })).toEqual({ x: 1, y: 1, rotation: 2 });
    expect(readStretch({ x: 1.2, y: 1.1, rotation: 0 })).toEqual({ x: 1.2, y: 1.1 });
    for (const bad of [null, undefined, 'x', [], {}, { x: 1, y: 1 }, { x: 0.9, y: 1 }, { x: 1.6, y: 1 }, { x: 1.2, y: Number.NaN }, { x: 1.2, y: 1.1, rotation: 6 }, { x: 1.2, y: 1.1, rotation: 'a' }]) {
      expect(readStretch(bad)).toBeNull();
    }
  });

  it("uses a level's own alignment over the grid's: its stretch times its scale, its offset only when one side is above 0", () => {
    const grid = { mapStretch: { x: 1.2, y: 1.2 } };
    const levels = {
      upper: { stretch: { x: 1.1, y: 1.1, rotation: 2 }, scale: 2, offset: { x: 100, y: 0 } },
      plain: { stretch: { x: 1, y: 1 }, scale: 0.5, offset: { x: 0, y: 0 } },
    };
    expect(effectiveAlignment(grid, levels, 'upper')).toEqual({ x: 2.2, y: 2.2, rotation: 2, offset: { x: 100, y: 0 } });
    expect(effectiveAlignment(grid, levels, 'plain')).toEqual({ x: 0.5, y: 0.5 });
    // A level with no entry, a scene without levels: the grid's.
    expect(effectiveAlignment(grid, levels, 'other')).toEqual({ x: 1.2, y: 1.2 });
    expect(effectiveAlignment(grid, undefined, null)).toEqual({ x: 1.2, y: 1.2 });
    expect(effectiveAlignment(null, undefined, null)).toBeNull();
  });

  it('draws a map unaligned rather than wrongly when a level alignment cannot be read', () => {
    for (const bad of [{ stretch: { x: 1, y: 1 }, scale: 0, offset: { x: 0, y: 0 } }, { stretch: { x: 1, y: 1 }, scale: 'big', offset: { x: 0, y: 0 } },
      { stretch: { x: 1, y: 1 }, scale: 1e9, offset: { x: 0, y: 0 } }]) {
      expect(effectiveAlignment(null, { l: bad }, 'l')).toBeNull();
    }
    // A bad offset is no offset, as the scale alone still places it.
    expect(effectiveAlignment(null, { l: { stretch: { x: 1, y: 1 }, scale: 2, offset: { x: 'a', y: 5 } } }, 'l')).toEqual({ x: 2, y: 2 });
    expect(effectiveAlignment(null, { l: { stretch: { x: 1, y: 1 }, scale: 2, offset: { x: 9e9, y: 5 } } }, 'l')).toEqual({ x: 2, y: 2 });
  });
});
