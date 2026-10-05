import { describe, expect, it } from 'vitest';
import { MAP_ICON_SVG } from '@atlas-vtt/shared/draw';
import { mapIconPaths } from '../../../src/app/online/view/mapIconPaths';

describe('map icon paths', () => {
  it('turns every Atlas map icon into path data', () => {
    for (const name of Object.keys(MAP_ICON_SVG)) {
      const paths = mapIconPaths(name);
      expect(paths?.length, name).toBeGreaterThan(0);
      for (const { d } of paths ?? []) expect(d, name).not.toMatch(/NaN|undefined/);
    }
  });

  it('reads rounded rectangles, lines, polylines and filled circles', () => {
    expect(mapIconPaths('lock')?.[0]).toEqual({
      d: 'M 5 11 h 14 a 2 2 0 0 1 2 2 v 7 a 2 2 0 0 1 -2 2 h -14 a 2 2 0 0 1 -2 -2 v -7 a 2 2 0 0 1 2 -2 Z', fill: false,
    });
    const swords = mapIconPaths('swords')?.map(({ d }) => d);
    expect(swords).toContain('M 14.5 17.5 L 3 6 L 3 3 L 6 3 L 17.5 14.5');
    expect(swords).toContain('M 13 19 L 19 13');
    expect(mapIconPaths('key-round')?.[1]).toEqual({ d: 'M 16 7.5 a 0.5 0.5 0 1 0 1 0 a 0.5 0.5 0 1 0 -1 0 Z', fill: true });
  });

  it('knows no other names', () => {
    for (const name of ['nope', '__proto__', 'constructor', 'toString']) expect(mapIconPaths(name), name).toBeNull();
  });
});
