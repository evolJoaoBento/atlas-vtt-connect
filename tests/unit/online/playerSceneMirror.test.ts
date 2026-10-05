import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerSceneMirror, RESYNC_MIN_INTERVAL_MS } from '../../../src/app/online/scene/PlayerSceneMirror';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene, playerToken, sceneBody } from './sceneFixtures';

function setup(): { mirror: PlayerSceneMirror; resyncs: number[]; changes: Array<PlayerScene | null> } {
  const resyncs: number[] = [];
  const changes: Array<PlayerScene | null> = [];
  const mirror = new PlayerSceneMirror({ sendResync: (seq) => resyncs.push(seq), onChange: (scene) => changes.push(scene) });
  return { mirror, resyncs, changes };
}

const scene = playerScene({ fog: { f1: fogRect(1), f2: fogRect(2, { erase: true }) } });

describe('PlayerSceneMirror', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows a snapshot once all its fog and drawing parts arrived', () => {
    const { mirror, changes } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 4, scene: sceneBody(scene), fogParts: 2, drawingParts: 1 });
    mirror.receive({ v: 1, type: 'scene-fog', seq: 5, part: 0, records: { f1: fogRect(1) } });
    mirror.receive({ v: 1, type: 'scene-drawings', seq: 6, part: 0, records: scene.drawings });
    expect(changes).toEqual([]);
    mirror.receive({ v: 1, type: 'scene-fog', seq: 7, part: 1, records: { f2: fogRect(2, { erase: true }) } });
    expect(mirror.scene).toEqual(scene);
    expect(changes).toHaveLength(1);
  });

  it("fills in the measurement an older GM's snapshot and patch lack", () => {
    const { mirror } = setup();
    const { measurement, ...older } = sceneBody(scene);
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: older as never, fogParts: 0, drawingParts: 0 });
    expect(mirror.scene?.measurement).toEqual(measurement);
    const { snapToGrid: _snap, coneAngle: _cone, ...noSnap } = measurement;
    mirror.receive({ v: 1, type: 'scene-patch', seq: 2, set: { measurement: { ...noSnap, unitDistance: 10 } as never }, upsert: {}, remove: {} });
    expect(mirror.scene?.measurement).toEqual({ ...measurement, unitDistance: 10 });
    // A GM before extension API 1.14.0 sends no rules square: it measured squares like cells.
    const { ruleDistance: _rule, ...noRule } = measurement;
    mirror.receive({ v: 1, type: 'scene-patch', seq: 3, set: { measurement: { ...noRule, unitDistance: 10 } as never }, upsert: {}, remove: {} });
    expect(mirror.scene?.measurement).toEqual({ ...measurement, unitDistance: 10, ruleDistance: 10 });
  });

  it('waits for the drawing parts too', () => {
    const { mirror, changes } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 1 });
    expect(mirror.scene).toBeNull();
    mirror.receive({ v: 1, type: 'scene-drawings', seq: 2, part: 0, records: scene.drawings });
    expect(mirror.scene?.drawings).toEqual(scene.drawings);
    expect(changes).toHaveLength(1);
  });

  it('shows a snapshot without parts at once and applies patches in order', () => {
    const { mirror, changes } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    expect(mirror.scene?.fog).toEqual({});
    expect(mirror.scene?.drawings).toEqual({});
    mirror.receive({ v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: { tokens: { t1: playerToken({ x: 400 }) } }, remove: {} });
    expect(mirror.scene?.tokens.t1?.x).toBe(400);
    expect(changes).toHaveLength(2);
  });

  it('discards a patch before any snapshot and asks for one', () => {
    const { mirror, resyncs } = setup();
    mirror.receive({ v: 1, type: 'scene-patch', seq: 1, set: {}, upsert: {}, remove: { tokens: ['t1'] } });
    expect(mirror.scene).toBeNull();
    expect(resyncs).toEqual([0]);
  });

  it('discards a patch after a gap and keeps the scene it has', () => {
    const { mirror, resyncs } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 3, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    mirror.receive({ v: 1, type: 'scene-patch', seq: 5, set: {}, upsert: {}, remove: { tokens: ['t1'] } });
    expect(mirror.scene?.tokens.t1).toBeDefined();
    expect(resyncs).toEqual([3]);
  });

  it('asks again when a part is missing, out of order or beyond its count', () => {
    const missing = setup();
    missing.mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 2, drawingParts: 0 });
    missing.mirror.receive({ v: 1, type: 'scene-fog', seq: 2, part: 1, records: {} });
    expect(missing.mirror.scene).toBeNull();
    expect(missing.resyncs).toEqual([1]);
    const extra = setup();
    extra.mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    extra.mirror.receive({ v: 1, type: 'scene-drawings', seq: 2, part: 0, records: {} });
    expect(extra.resyncs).toEqual([1]);
  });

  it('asks for a resync at most once per second', () => {
    const { mirror, resyncs } = setup();
    mirror.invalid();
    mirror.invalid();
    mirror.invalid();
    expect(resyncs).toEqual([0]);
    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS - 1);
    expect(resyncs).toEqual([0]);
    vi.advanceTimersByTime(1);
    expect(resyncs).toEqual([0, 0]);
  });

  it('drops a pending resync when a snapshot arrives', () => {
    const { mirror, resyncs } = setup();
    mirror.invalid();
    mirror.invalid();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 9, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS);
    expect(resyncs).toEqual([0]);
  });

  it('clears the scene at any seq', () => {
    const { mirror, changes } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    mirror.receive({ v: 1, type: 'scene-clear', seq: 7 });
    expect(mirror.scene).toBeNull();
    expect(changes.at(-1)).toBeNull();
    mirror.receive({ v: 1, type: 'scene-patch', seq: 8, set: {}, upsert: {}, remove: {} });
    expect(mirror.scene).toBeNull();
  });

  it('copies named fields only from a snapshot body', () => {
    const { mirror } = setup();
    const body = { ...sceneBody(scene), secret: 1 } as unknown as ReturnType<typeof sceneBody>;
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: 0, drawingParts: 0 });
    expect(mirror.scene).not.toBeNull();
    expect(Object.hasOwn(mirror.scene as object, 'secret')).toBe(false);
  });

  it('merges a part with a __proto__ record id without touching the prototype', () => {
    const { mirror } = setup();
    mirror.receive({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 1, drawingParts: 0 });
    const records = JSON.parse('{"__proto__": {"kind":"rect","x":1,"y":1,"width":1,"height":1,"erase":false,"order":1}}') as Record<string, never>;
    mirror.receive({ v: 1, type: 'scene-fog', seq: 2, part: 0, records });
    const fog = mirror.scene?.fog as Record<string, unknown>;
    expect(Object.getPrototypeOf(fog)).toBe(Object.prototype);
    expect(Object.hasOwn(fog, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).kind).toBeUndefined();
  });
});
