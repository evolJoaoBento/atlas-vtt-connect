import { describe, expect, it } from 'vitest';
import { drawTools, MEASURE_ACCENT } from '../../../src/app/online/view/tools/toolsLayer';
import type { ToolOverlay } from '../../../src/app/online/view/tools/PlayerTools';
import { RecordingSurface } from './recordingSurface';

const NONE: ToolOverlay = { measure: null, ruler: null, lasers: [] };

describe('the tools overlay', () => {
  it('draws nothing while no tool is in use', () => {
    const surface = new RecordingSurface();
    drawTools(surface, NONE, 1);
    expect(surface.calls).toEqual([]);
  });

  it("draws a line measurement like Atlas: shadow, body and core, its points, and the label on a pill above", () => {
    const surface = new RecordingSurface();
    drawTools(surface, { ...NONE, measure: { shape: 'line', start: { x: 0, y: 0 }, end: { x: 140, y: 0 }, label: '10ft', coneOpening: Math.PI / 2 } }, 1);
    expect(surface.ops('paths').map(({ style }) => [style.stroke, style.lineWidth, style.alpha])).toEqual([
      ['#000000', 6, 0.3], [MEASURE_ACCENT, 4, 0.8], [MEASURE_ACCENT, 2, 1],
    ]);
    expect(surface.ops('circle').map(({ radius }) => radius)).toEqual([11, 8, 7, 11, 8, 7]);
    expect(surface.ops('roundRect')).toHaveLength(2);
    expect(surface.ops('text')).toEqual([
      expect.objectContaining({ text: '10ft', x: 70, y: -30, style: expect.objectContaining({ font: '16px sans-serif', color: '#ffffff', align: 'center' }) }),
    ]);
  });

  it('draws circles and cones with a faint fill and an outline, and never a negative radius', () => {
    const surface = new RecordingSurface();
    drawTools(surface, { ...NONE, measure: { shape: 'circle', start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, label: '0ft', coneOpening: Math.PI / 2 } }, 1);
    expect(surface.ops('circle').every(({ radius }) => radius >= 0)).toBe(true);
    surface.clear();
    drawTools(surface, { ...NONE, measure: { shape: 'cone', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, label: '5ft', coneOpening: Math.PI / 2 } }, 1);
    const [fill, outline] = surface.ops('paths');
    expect(fill).toMatchObject({ closed: true, style: { fill: MEASURE_ACCENT, alpha: 0.1 } });
    expect(outline).toMatchObject({ closed: false, style: { stroke: MEASURE_ACCENT, lineWidth: 3, alpha: 0.8 } });
    expect(outline!.paths).toHaveLength(3);
  });

  it("opens a cone by the GM's cone angle", () => {
    const surface = new RecordingSurface();
    const opening = (53.13 * Math.PI) / 180;
    drawTools(surface, { ...NONE, measure: { shape: 'cone', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, label: '5ft', coneOpening: opening } }, 1);
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

  it("draws a laser like Atlas's Canvas beam: the body in its colour and a white filament, round", () => {
    const surface = new RecordingSurface();
    const trail = [{ x: 0, y: 0, life: 1 }, { x: 50, y: 0, life: 1 }];
    drawTools(surface, { ...NONE, lasers: [{ from: 'p1', color: '#ff9f2e', trail, head: { x: 50, y: 0 } }] }, 1);
    const paths = surface.ops('paths');
    expect(paths.map(({ style }) => style.stroke)).toEqual(['#ff9f2e', '#ffffff']);
    expect(paths.every(({ style }) => style.round === true)).toBe(true);
    expect(paths[1]!.style.lineWidth).toBeCloseTo(paths[0]!.style.lineWidth! * 0.25);
  });
});
