import { describe, expect, it } from 'vitest';
import { createPinsLayer, pinAt } from '../../../src/app/online/view/layers/pinsLayer';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

const scene = { ...playerScene(), pins: [{ id: 'pin-0', x: 100, y: 100, label: '1', title: 'Cellar' }, { id: 'pin-1', x: 400, y: 100, label: null, title: null, icon: 'treasure' }] };

describe('readable pins for players', () => {
  it("draw Atlas's badge at a constant screen size: the label, or the icon in its tone, and the readable mark", () => {
    const surface = new RecordingSurface();
    createPinsLayer().draw(surface, frame(scene, { zoom: 2 }));
    // Half a world unit per marker unit at zoom 2, so the 20-unit badge is 20 screen pixels wide either way.
    expect(surface.ops('push').filter(({ scale }) => scale === 0.5).map(({ x }) => x)).toEqual([100, 400]);
    expect(surface.ops('circle').filter(({ radius, style }) => radius === 20 && style.fill).map(({ style }) => style.fill)).toEqual(['#2a2a2a', '#2a2a2a']);
    expect(surface.ops('text').map(({ text, style }) => [text, style.color])).toEqual([['1', '#ffffff']]);
    expect(surface.ops('pinGlyph')).toEqual([{ op: 'pinGlyph', name: 'treasure', x: 0, y: 0, size: 22, color: '#e3b341' }]);
    // Each pin's open-book mark: two pages.
    expect(surface.ops('paths').filter(({ paths }) => paths.length === 2)).toHaveLength(2);
  });

  it("take Atlas's light badge on a light page", () => {
    const surface = new RecordingSurface();
    createPinsLayer().draw(surface, frame(scene, { dark: false }));
    expect(surface.ops('circle').find(({ radius, style }) => radius === 20 && style.fill)?.style.fill).toBe('#e3e3e3');
    expect(surface.ops('pinGlyph')[0]?.color).toBe('#a16207');
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
