import { describe, expect, it } from 'vitest';
import type { DrawingStroke } from '@atlas-vtt/api-types';
import { projectDrawingShape } from '../../../src/app/online/scene/projectRecords';
import { isDrawingRecords } from '../../../src/app/online/scene/sceneValidation';
import type { PlayerDrawing } from '../../../src/app/online/scene/sceneTypes';
import { createDrawingsLayer } from '../../../src/app/online/view/layers/drawingsLayer';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }];
const hole = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }];
const stroke = (more: Record<string, unknown>): DrawingStroke => ({ id: 'd', kind: 'drawing', timestamp: 1, type: 'pen', points: square, color: '#000000', width: 3, opacity: 1, ...more } as DrawingStroke);

describe("Atlas 0.16's drawings as players get them", () => {
  it('a closed drawing goes with its fill and holes, a line of no width as none; an open one has no fill; a stamp with its turn', () => {
    expect(projectDrawingShape(stroke({ type: 'rectangle', width: 0, fill: 'solid', holes: [hole] }))).toMatchObject({ type: 'rectangle', width: 0, fill: 'solid', holes: [hole] });
    expect(projectDrawingShape(stroke({ fill: 'soft' }))).toMatchObject({ fill: 'soft' });
    const open = projectDrawingShape(stroke({ points: [{ x: 0, y: 0 }, { x: 9, y: 9 }], fill: 'solid' }))!;
    expect([open.fill, open.holes]).toEqual([undefined, undefined]);
    expect(projectDrawingShape(stroke({ type: 'icon', icon: 'pin', points: [{ x: 5, y: 6 }], width: 70, rotation: 45 }))).toMatchObject({ type: 'icon', icon: 'pin', rotation: 45 });
    // A 0.15 drawing: as before, nothing new on it.
    const old = projectDrawingShape(stroke({ points: [{ x: 0, y: 0 }, { x: 9, y: 9 }] }))!;
    expect(['fill', 'holes', 'rotation'].filter((key) => key in old)).toEqual([]);
  });

  it('a scene with them is well formed; a fill or holes that are none are refused', () => {
    const drawing = (more: Partial<PlayerDrawing> & Record<string, unknown>): PlayerDrawing => ({ type: 'rectangle', order: 1, points: square, color: '#000000', width: 0, opacity: 1, icon: null, ...more } as PlayerDrawing);
    expect(isDrawingRecords({ a: drawing({ fill: 'solid', holes: [hole] }), b: drawing({ type: 'icon', icon: 'pin', rotation: 45 }) })).toBe(true);
    expect(isDrawingRecords({ a: drawing({ fill: 'opaque' } as never) })).toBe(false);
    expect(isDrawingRecords({ a: drawing({ fill: 'solid', holes: [[{ x: 1 }]] } as never) })).toBe(false);
    expect(isDrawingRecords({ a: drawing({ rotation: 'x' } as never) })).toBe(false);
  });

  it("a player's view draws a fill with its holes cut out (wound against the outline, as Atlas's nonzero fill needs), under its line; a pin stamp turned; a line of no width is no line", () => {
    const surface = new RecordingSurface();
    const drawings: Record<string, PlayerDrawing> = {
      box: { type: 'rectangle', order: 1, points: square, color: '#000000', width: 0, opacity: 1, icon: null, fill: 'solid', holes: [hole] },
      soft: { type: 'rectangle', order: 2, points: square, color: '#ff0000', width: 4, opacity: 0.8, icon: null, fill: 'soft' },
      mark: { type: 'icon', order: 3, points: [{ x: 50, y: 50 }], color: '#00ff00', width: 70, opacity: 1, icon: 'pin', rotation: 90 },
    };
    createDrawingsLayer().draw(surface, frame(playerScene({ drawings })));
    expect(surface.calls).toEqual([
      { op: 'paths', paths: [square, [...square].slice(0, 0).concat([...hole].reverse())], closed: true, style: { fill: '#000000', alpha: 1 } },
      { op: 'paths', paths: [square], closed: true, style: { fill: '#ff0000', alpha: 0.2 } },
      { op: 'paths', paths: [square], closed: false, style: { stroke: '#ff0000', lineWidth: 4, alpha: 0.8, round: true } },
      { op: 'push', x: 50, y: 50, rotation: Math.PI / 2, scale: 1 },
      { op: 'pinGlyph', name: 'pin', x: 0, y: 0, size: 70, color: '#00ff00' },
      { op: 'pop' },
    ]);
  });
});
