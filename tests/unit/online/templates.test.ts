import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { templateContains, type MapTemplate } from '../../../src/app/online/tools/templates';

const add = (x = 0) => ({ v: 1 as const, type: 'map-template' as const, sceneId: 's1', add: { shape: 'circle' as const, start: { x, y: 0 }, end: { x: x + 10, y: 0 } } });

// How templates are kept (in Atlas's measures, one per player) is pinned by measureHost.test.ts.
describe('template requests and shapes', () => {
  it('pass the wire checks only as a single add or remove', () => {
    const kind = (message: unknown): string => decodeControl(encodeControl(message as ControlMessage)).kind;
    expect(kind(add())).toBe('message');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', remove: 't1' })).toBe('message');
    expect(kind({ ...add(), remove: 't1' })).toBe('invalid');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', add: { shape: 'square', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } })).toBe('message');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', add: { shape: 'hexagon', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } })).toBe('invalid');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', clear: true })).toBe('message');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', clear: true, remove: 't1' })).toBe('invalid');
  });

  it('find whether a point lies on one', () => {
    const circle: MapTemplate = { id: 't', owner: 'p', shape: 'circle', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, color: '#ffffff' };
    expect(templateContains(circle, { x: 5, y: 5 }, Math.PI / 2, 0)).toBe(true);
    expect(templateContains(circle, { x: 20, y: 0 }, Math.PI / 2, 0)).toBe(false);
    const cone = { ...circle, shape: 'cone' as const };
    expect(templateContains(cone, { x: 8, y: 1 }, Math.PI / 2, 0)).toBe(true);
    expect(templateContains(cone, { x: -5, y: 0 }, Math.PI / 2, 0)).toBe(false);
    const line = { ...circle, shape: 'line' as const };
    expect(templateContains(line, { x: 5, y: 1 }, 0, 2)).toBe(true);
    expect(templateContains(line, { x: 5, y: 4 }, 0, 2)).toBe(false);
  });
});
