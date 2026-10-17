import { describe, expect, it } from 'vitest';
import { drawTools, MEASURE_ACCENT } from '../../../src/app/online/view/tools/toolsLayer';
import type { ToolOverlay } from '../../../src/app/online/view/tools/PlayerTools';
import { RecordingSurface } from './recordingSurface';

const NONE: ToolOverlay = { measure: null, ruler: null, lasers: [], pings: [], templates: [], coneOpening: Math.PI / 2 };

describe('the tools overlay', () => {
  it('draws nothing while no tool is in use', () => {
    const surface = new RecordingSurface();
    drawTools(surface, NONE, 1);
    expect(surface.calls).toEqual([]);
  });

  it("draws a line measurement like Atlas: shadow, body and core, its points, and the label on a pill above", () => {
    const surface = new RecordingSurface();
    drawTools(surface, { ...NONE, measure: { shape: 'line', start: { x: 0, y: 0 }, end: { x: 140, y: 0 }, label: '10ft', coneOpening: Math.PI / 2, color: MEASURE_ACCENT } }, 1);
    expect(surface.ops('paths').map(({ style }) => [style.stroke, style.lineWidth, style.alpha])).toEqual([
      ['#000000', 6, 0.3], [MEASURE_ACCENT, 4, 0.8], [MEASURE_ACCENT, 2, 1],
    ]);
    expect(surface.ops('circle').map(({ radius }) => radius)).toEqual([11, 8, 7, 11, 8, 7]);
    expect(surface.ops('roundRect')).toHaveLength(2);
    expect(surface.ops('text')).toEqual([
      expect.objectContaining({ text: '10ft', x: 70, y: -30, style: expect.objectContaining({ font: '16px sans-serif', color: '#ffffff', align: 'center' }) }),
    ]);
  });

  it("keeps a label at least 16 px on screen when zoomed out, and draws it in the player's colour", () => {
    const surface = new RecordingSurface();
    drawTools(surface, { ...NONE, measure: { shape: 'line', start: { x: 0, y: 0 }, end: { x: 1400, y: 0 }, label: '100ft', coneOpening: Math.PI / 2, color: '#22c55e' } }, 0.25);
    expect(surface.ops('text')[0]?.style.font).toBe('64px sans-serif');
    expect(surface.ops('paths').map(({ style }) => style.stroke)).toContain('#22c55e');
  });

  it('draws circles and cones with a faint fill and an outline, and never a negative radius', () => {
    const surface = new RecordingSurface();
    drawTools(surface, { ...NONE, measure: { shape: 'circle', start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, label: '0ft', coneOpening: Math.PI / 2, color: MEASURE_ACCENT } }, 1);
    expect(surface.ops('circle').every(({ radius }) => radius >= 0)).toBe(true);
    surface.clear();
    drawTools(surface, { ...NONE, measure: { shape: 'cone', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, label: '5ft', coneOpening: Math.PI / 2, color: MEASURE_ACCENT } }, 1);
    const [fill, outline] = surface.ops('paths');
    expect(fill).toMatchObject({ closed: true, style: { fill: MEASURE_ACCENT, alpha: 0.1 } });
    expect(outline).toMatchObject({ closed: false, style: { stroke: MEASURE_ACCENT, lineWidth: 3, alpha: 0.8 } });
    expect(outline!.paths).toHaveLength(3);
  });

  it("opens a cone by the GM's cone angle", () => {
    const surface = new RecordingSurface();
    const opening = (53.13 * Math.PI) / 180;
    drawTools(surface, { ...NONE, measure: { shape: 'cone', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, label: '5ft', coneOpening: opening, color: MEASURE_ACCENT } }, 1);
    const [left, right] = surface.ops('paths')[1]!.paths;
    const angle = (path: readonly { x: number; y: number }[] | undefined): number => Math.atan2(path![1]!.y, path![1]!.x);
    expect(angle(right) - angle(left)).toBeCloseTo(opening);
  });

  it('draws the drag ruler through its waypoints, marking all but the end, labelled halfway', () => {
    const surface = new RecordingSurface();
    drawTools(surface, { ...NONE, ruler: { points: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }], label: '10ft' } }, 1);
    expect(surface.ops('paths')[0]!.paths[0]).toHaveLength(3);
    expect(surface.ops('circle')).toHaveLength(6);
    expect(surface.ops('text')[0]).toMatchObject({ text: '10ft', x: 70, y: 0 });
  });

  it("draws a laser as Atlas's WebGL beam: a glow in its colour, white-hot at the core and at the held point", () => {
    const surface = new RecordingSurface();
    const trail = [{ x: 0, y: 0, life: 1 }, { x: 50, y: 0, life: 1 }];
    drawTools(surface, { ...NONE, lasers: [{ from: 'p1', color: '#ff9f2e', trail, head: { x: 50, y: 0 } }] }, 1);
    const [raster] = surface.ops('raster');
    expect(surface.ops('paths')).toEqual([]);
    const { image, x, y } = raster!;
    const at = (worldX: number, worldY: number): number[] => {
      const index = (Math.floor(worldY - y) * image.width + Math.floor(worldX - x)) * 4;
      return [...image.data.slice(index, index + 4)];
    };
    // Default size 16: a body 5.6 wide either side, the glow reaching 24.
    expect(raster!.height).toBeGreaterThanOrEqual(48);
    const [r, g, b, a] = at(25, 10);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(160);
    expect([r, g, b]).toEqual([255, 159, 46]);
    // The core of the beam, away from the held point, is mostly the colour lit towards white; at the held point, white.
    expect(at(10, 0)[3]!).toBeGreaterThan(250);
    expect(at(10, 0)[2]!).toBeGreaterThan(46);
    expect(at(50, 0).slice(0, 3).every((channel) => channel > 200)).toBe(true);
  });

  it('fades an old part of a laser out as well as narrowing it, as Atlas does', () => {
    const strength = (life: number): number => {
      const surface = new RecordingSurface();
      drawTools(surface, { ...NONE, lasers: [{ from: 'p1', color: '#ff0059', trail: [{ x: 0, y: 0, life }, { x: 50, y: 0, life }], head: null }] }, 1);
      const raster = surface.ops('raster')[0];
      if (!raster) return 0;
      const { image, x, y } = raster;
      return image.data[(Math.floor(-y) * image.width + Math.floor(25 - x)) * 4 + 3]!;
    };
    expect(strength(1)).toBeGreaterThan(250);
    expect(strength(0.2)).toBeGreaterThan(0);
    expect(strength(0.2)).toBeLessThan(200);
    expect(strength(0)).toBe(0);
  });

  it("draws a ruler's label in Atlas's light-theme colours on a light page: a pale pill, dark text", () => {
    const measure = { shape: 'line' as const, start: { x: 0, y: 0 }, end: { x: 140, y: 0 }, label: '10ft', coneOpening: Math.PI / 2, color: MEASURE_ACCENT };
    const light = new RecordingSurface();
    drawTools(light, { ...NONE, measure }, 1, 1, false);
    expect(light.ops('roundRect')[0]!.style.fill).toBe('#e3e3e3');
    expect(light.ops('text')[0]!.style.color).toBe('#000000');
    const dark = new RecordingSurface();
    drawTools(dark, { ...NONE, measure }, 1);
    expect(dark.ops('roundRect')[0]!.style.fill).toBe('#2a2a2a');
    expect(dark.ops('text')[0]!.style.color).toBe('#ffffff');
  });

  it("falls back to Atlas's Canvas beam when a laser is too wide to work out by pixel", () => {
    const surface = new RecordingSurface();
    const trail = [{ x: 0, y: 0, life: 1 }, { x: 100_000, y: 100_000, life: 1 }];
    drawTools(surface, { ...NONE, lasers: [{ from: 'p1', color: '#ff9f2e', trail, head: null }] }, 1);
    expect(surface.ops('raster')).toEqual([]);
    const paths = surface.ops('paths');
    expect(new Set(paths.map(({ style }) => style.stroke))).toEqual(new Set(['#ff9f2e', '#ffffff']));
    expect(paths.every(({ style }) => style.round === true)).toBe(true);
  });
});
