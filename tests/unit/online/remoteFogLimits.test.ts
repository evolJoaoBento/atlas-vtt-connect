import type { FogOperation } from '@atlas-vtt/api-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepFogIdentity } from '../../../src/app/online/scene/fogIdentity';
import { PlayerSceneMirror } from '../../../src/app/online/scene/PlayerSceneMirror';
import { createProjectionMemo } from '../../../src/app/online/scene/projectRecords';
import { addFogStats, fogOverRemoteLimits, fogStats, NO_FOG_STATS, REMOTE_FOG_LIMITS } from '../../../src/app/online/scene/remoteFogLimits';
import { FogCoverageCache } from '../../../src/app/online/scene/sceneSources';
import type { PlayerFogOp, PlayerScene, ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { RemoteSceneMemo } from '../../../src/app/online/obsidian/remote/toRemoteScene';
import { DARKNESS_FOG_ID, darknessOf } from '../../../src/app/online/scene/darknessFog';
import { fogRect, playerScene, sceneBody } from './sceneFixtures';

const MAP = { width: 1000, height: 800 };
/** A zigzag, which the wire's 1 px simplification keeps. */
const points = (count: number): ScenePoint[] => Array.from({ length: count }, (_, i) => ({ x: i % 900, y: (i % 2) * 40 + Math.floor(i / 900) * 100 }));
const lasso = (count: number, order = 1): PlayerFogOp => ({ type: 'lasso', erase: false, order, points: points(count) });
const brush = (radius: number, order = 1): PlayerFogOp => ({ type: 'brush', erase: false, order, radius, points: points(2) });
const many = (count: number): Record<string, PlayerFogOp> => Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, fogRect(i)]));
const over = (fog: Record<string, PlayerFogOp>, map = MAP): boolean => fogOverRemoteLimits(fogStats(fog), map);

describe("Atlas's remote fog limits", () => {
  it('allows 2,000 operations and not 2,001', () => {
    expect(over(many(REMOTE_FOG_LIMITS.ops))).toBe(false);
    expect(over(many(REMOTE_FOG_LIMITS.ops + 1))).toBe(true);
  });

  it('allows 10,000 points in one operation and not 10,001', () => {
    expect(over({ a: lasso(REMOTE_FOG_LIMITS.opPoints) })).toBe(false);
    expect(over({ a: lasso(REMOTE_FOG_LIMITS.opPoints + 1) })).toBe(true);
  });

  it('allows 200,000 points in all and not one more', () => {
    const twenty = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`l${i}`, lasso(REMOTE_FOG_LIMITS.opPoints, i)]));
    expect(over(twenty)).toBe(false);
    expect(over({ ...twenty, extra: lasso(1) })).toBe(true);
  });

  it("allows a brush as wide as the map's longer side and not wider, or 100,000 while the map has no size", () => {
    expect(over({ a: brush(1000) })).toBe(false);
    expect(over({ a: brush(1001) })).toBe(true);
    expect(over({ a: brush(100_000) }, { width: 0, height: 0 })).toBe(false);
    expect(over({ a: brush(100_001) }, { width: 0, height: 0 })).toBe(true);
  });

  it('counts rectangles as operations without points, and adds stats', () => {
    expect(fogStats({ a: fogRect(1) })).toEqual({ ops: 1, points: 0, maxOpPoints: 0, maxRadius: 0 });
    expect(addFogStats({ ...NO_FOG_STATS, ops: 2, points: 5, maxOpPoints: 3, maxRadius: 4 }, { ...NO_FOG_STATS, ops: 1, points: 7, maxOpPoints: 7, maxRadius: 2 }))
      .toEqual({ ops: 3, points: 12, maxOpPoints: 7, maxRadius: 4 });
  });

  describe('on the GM side (the cache that decides on a clear and the notice)', () => {
    const rect = (id: string): FogOperation => ({ id, kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 0, y: 0, width: 1, height: 1 });
    const rects = (count: number): Record<string, FogOperation> => Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, rect(`f${i}`)]));
    const brushOp = (radius: number): FogOperation => ({ id: 'b', kind: 'fog', type: 'brush', timestamp: 1, isErasing: false, brushRadius: radius, points: [{ x: 5, y: 5 }, { x: 9, y: 9 }] } as FogOperation);
    const lassoOp = (count: number): FogOperation => ({ id: 'l', kind: 'fog', type: 'lasso', timestamp: 1, isErasing: false, points: points(count) } as FogOperation);
    const truncated = (fog: Record<string, FogOperation>, map = MAP, darkness = darknessOf({ cols: 0, rows: 0, cellSize: 1, map, dark: new Uint8Array(0) })): boolean =>
      new FogCoverageCache().get(fog, createProjectionMemo(), darkness, map).truncated;

    it('truncates above 2,000 operations, the darkness counting as one', () => {
      expect(truncated(rects(2000))).toBe(false);
      expect(truncated(rects(2001))).toBe(true);
      const darkness = darknessOf({ cols: 2, rows: 2, cellSize: 100, map: MAP, dark: Uint8Array.of(1, 0, 0, 1) });
      expect(Object.keys(darkness.fog)).toEqual([DARKNESS_FOG_ID]);
      expect(truncated(rects(1999), MAP, darkness)).toBe(false);
      expect(truncated(rects(2000), MAP, darkness)).toBe(true);
    });

    it('truncates for a brush wider than the map, and for too many points in one operation or in all', () => {
      expect(truncated({ b: brushOp(800) })).toBe(false);
      expect(truncated({ b: brushOp(1000) })).toBe(false);
      expect(truncated({ b: brushOp(1001) })).toBe(true);
      expect(truncated({ l: lassoOp(4000) })).toBe(false);
    });

    it('sums the points of what players get, so 41 lassos of 5,000 points are too many', () => {
      const lassos = (count: number): Record<string, FogOperation> => Object.fromEntries(Array.from({ length: count }, (_, i) => [`l${i}`, { ...lassoOp(5000), id: `l${i}` }]));
      expect(truncated(lassos(40))).toBe(false);
      expect(truncated(lassos(41))).toBe(true);
    });
  });
});

describe('what the player side receives', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function setup(): { mirror: PlayerSceneMirror; resyncs: number[]; changes: Array<PlayerScene | null> } {
    const resyncs: number[] = [];
    const changes: Array<PlayerScene | null> = [];
    const mirror = new PlayerSceneMirror({ sendResync: (seq) => resyncs.push(seq), onChange: (scene) => changes.push(scene) });
    return { mirror, resyncs, changes };
  }
  const snapshot = (fog: Record<string, PlayerFogOp>, seq = 1) => {
    const scene = playerScene({ fog });
    return { v: 1 as const, type: 'scene-snapshot' as const, seq, scene: sceneBody(scene), fogParts: 1, drawingParts: 0 };
  };
  const part = (fog: Record<string, PlayerFogOp>, seq = 2) => ({ v: 1 as const, type: 'scene-fog' as const, seq, part: 0, records: fog });

  it('shows fog within the limits', () => {
    const { mirror } = setup();
    const fog = many(REMOTE_FOG_LIMITS.ops);
    mirror.receive(snapshot(fog));
    mirror.receive(part(fog));
    expect(Object.keys(mirror.scene?.fog ?? {})).toHaveLength(REMOTE_FOG_LIMITS.ops);
  });

  it.each([
    ['more than 2,000 operations', many(REMOTE_FOG_LIMITS.ops + 1)],
    ['more than 10,000 points in one operation', { a: lasso(REMOTE_FOG_LIMITS.opPoints + 1) }],
    ['a brush wider than the map', { a: brush(10_000) }],
  ])('hides the scene, without asking for a resync, for %s', (_name, fog) => {
    const { mirror, resyncs, changes } = setup();
    mirror.receive(snapshot(many(1)));
    mirror.receive(part(many(1)));
    changes.length = 0;
    mirror.receive(snapshot(fog, 3));
    mirror.receive(part(fog, 4));
    expect(mirror.scene).toBeNull();
    expect(changes).toEqual([null]);
    // Patches that follow are followed in order and show nothing; the next snapshot shows the scene again.
    mirror.receive({ v: 1, type: 'scene-patch', seq: 5, set: {}, upsert: {}, remove: {} });
    expect(mirror.scene).toBeNull();
    expect(resyncs).toEqual([]);
    mirror.receive(snapshot(many(1), 6));
    mirror.receive(part(many(1), 7));
    expect(mirror.scene).not.toBeNull();
  });

  it('hides the scene when a patch takes its fog past the limit', () => {
    const { mirror } = setup();
    const fog = many(REMOTE_FOG_LIMITS.ops);
    mirror.receive(snapshot(fog));
    mirror.receive(part(fog));
    mirror.receive({ v: 1, type: 'scene-patch', seq: 3, set: {}, upsert: { fog: { extra: fogRect(9) } }, remove: {} });
    expect(mirror.scene).toBeNull();
  });

  it('keeps the same fog objects when a snapshot repeats fog that did not change', () => {
    const { mirror } = setup();
    const fog = { a: fogRect(1), b: lasso(4, 2) };
    mirror.receive(snapshot(fog));
    mirror.receive(part(fog));
    const first = mirror.scene!.fog;
    mirror.receive(snapshot(structuredClone(fog), 3));
    mirror.receive(part(structuredClone(fog), 4));
    expect(mirror.scene!.fog).toBe(first);
    mirror.receive(snapshot({ a: fogRect(1), b: lasso(4, 9) }, 5));
    mirror.receive(part({ a: fogRect(1), b: lasso(4, 9) }, 6));
    expect(mirror.scene!.fog).not.toBe(first);
    expect(mirror.scene!.fog.a).toBe(first.a);
  });

  it('keepFogIdentity reuses equal operations only', () => {
    const previous = { a: fogRect(1), b: fogRect(2) };
    const same = keepFogIdentity(previous, { a: fogRect(1), b: fogRect(2) });
    expect(same).toBe(previous);
    const changed = keepFogIdentity(previous, { a: fogRect(1), b: fogRect(3) });
    expect(changed).not.toBe(previous);
    expect(changed.a).toBe(previous.a);
    expect(changed.b).not.toBe(previous.b);
    expect(keepFogIdentity(previous, { a: fogRect(1) })).not.toBe(previous);
    expect(keepFogIdentity(undefined, previous)).toBe(previous);
  });
});

describe("the fog handed to Atlas's remote view", () => {
  const images = { token: () => null, background: () => null } as never;

  it('is the same objects, and the same fog record, while the fog is the same by value', () => {
    const memo = new RemoteSceneMemo();
    const fog = { a: fogRect(1), b: lasso(6, 2) };
    const first = memo.input(playerScene({ fog }), images);
    for (let i = 0; i < 5; i++) {
      const next = memo.input(playerScene({ fog: structuredClone(fog) }), images);
      expect(next.objects.fog).toBe(first.objects.fog);
      expect(next.objects.fog.a).toBe(first.objects.fog.a);
    }
  });

  it('hands new objects for what changed and keeps the others', () => {
    const memo = new RemoteSceneMemo();
    const first = memo.input(playerScene({ fog: { a: fogRect(1), b: fogRect(2) } }), images);
    const next = memo.input(playerScene({ fog: { a: fogRect(1), b: fogRect(5) } }), images);
    expect(next.objects.fog).not.toBe(first.objects.fog);
    expect(next.objects.fog.a).toBe(first.objects.fog.a);
    expect(next.objects.fog.b).not.toBe(first.objects.fog.b);
    const fewer = memo.input(playerScene({ fog: { a: fogRect(1) } }), images);
    expect(Object.keys(fewer.objects.fog)).toEqual(['a']);
  });
});
