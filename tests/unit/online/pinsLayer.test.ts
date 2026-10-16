import { describe, expect, it } from 'vitest';
import { createPinsLayer, PIN_COLORS, pinAt } from '../../../src/app/online/view/layers/pinsLayer';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

const scene = { ...playerScene(), pins: [{ id: 'pin-0', x: 100, y: 100, label: '1', title: 'Cellar' }, { id: 'pin-1', x: 400, y: 100, label: null, title: null }] };

describe('readable pins for players', () => {
  it('draw a marker of constant screen size, with the label', () => {
    const surface = new RecordingSurface();
    createPinsLayer().draw(surface, frame(scene, { zoom: 2 }));
    expect(surface.ops('circle').map(({ x, radius, style }) => [x, radius, style.fill])).toEqual([[100, 5, PIN_COLORS.fill], [400, 5, PIN_COLORS.fill]]);
    expect(surface.ops('text').map(({ text }) => text)).toEqual(['1']);
  });

  it('are found under the pointer by their marker', () => {
    expect(pinAt(scene, { x: 104, y: 100 }, 1)?.title).toBe('Cellar');
    expect(pinAt(scene, { x: 130, y: 100 }, 1)).toBeNull();
    expect(pinAt(scene, { x: 130, y: 100 }, 0.25)?.title).toBe('Cellar');
  });

  it('pass the wire checks, and a bad pin fails the scene', () => {
    const snapshot = (pins: unknown): unknown => decodeControl(encodeControl({ v: 1, type: 'scene-patch', sceneId: 's', seq: 1, set: { pins }, upsert: {}, remove: {} } as never));
    expect((snapshot(scene.pins) as { kind: string }).kind).toBe('message');
    expect((snapshot([{ id: 'p', x: 'no', y: 0, label: null, title: null }]) as { kind: string }).kind).toBe('invalid');
  });
});
