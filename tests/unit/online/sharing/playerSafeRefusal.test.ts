import { describe, expect, it } from 'vitest';
import type { FogOperation } from '@atlas-vtt/api-types';
import { FogCoverageCache } from '../../../../src/app/online/scene/sceneSources';
import { createProjectionMemo, fogTruncated } from '../../../../src/app/online/scene/projectRecords';
import { SCENE_LIMITS } from '../../../../src/app/online/scene/sceneLimits';
import {
  FOG_TRUNCATED_NOT_PLAYER_SAFE, LIGHTING_UNKNOWN_NOT_PLAYER_SAFE, LIT_MAP_NOT_PLAYER_SAFE, playerSafePayload, playerSafeRefusal,
  readSharedMap, type PayloadContext,
} from '../../../../src/app/online/sharing/model/buildMapPayload';
import { clippedPinText, PIN_TEXT_LIMIT } from '../../../../src/app/online/sharing/model/mapPayload';
import { mapFile, sourceOf } from './mapFileFixture';

// Final review I1, M1, M2, M5, M6: a player-safe share refuses a map whose fog players could not be sent whole, as
// live play sends a clear (`FOG_TRUNCATED_NOTICE`), and never fails open on what it cannot read.

const SIZE = { width: 1000, height: 1000 };
const NOTE = 'n'.repeat(22);
const context: PayloadContext = {
  rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true }, collectionGrid: null, coneAngle: 90,
  initiativeRules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' },
  images: { fingerprints: new Map(), size: SIZE }, noteItem: () => NOTE, linked: [NOTE], isFile: () => false,
};
let stamp = 1;
const rect = (x: number, y: number, width: number, height: number, extra: Partial<FogOperation> = {}): FogOperation =>
  ({ id: `f${stamp}`, kind: 'fog', type: 'rectangle', timestamp: stamp++, isErasing: false, x, y, width, height, ...extra } as FogOperation);
const TOKEN = { hero: { id: 'hero', kind: 'character', x: 500, y: 500, size: 1, imagePath: 'art/a.png', name: 'Hero' } };
const PIN = { inn: { id: 'inn', kind: 'pin', x: 500, y: 500, notePath: 'Notes/Inn.md' } };

/** 10,000 specks of fog in a corner, then one more over the token and the pin (insertion order: the last one). */
function crowdedFog(): Record<string, FogOperation> {
  const fog: Record<string, FogOperation> = {};
  for (let index = 0; index < SCENE_LIMITS.records; index++) fog[`speck${index}`] = rect(0, 0, 1, 1);
  fog.last = rect(400, 400, 200, 200);
  return fog;
}

const sourceWith = (fog: Record<string, FogOperation>, lit: boolean | null = false): ReturnType<typeof sourceOf> =>
  ({ ...sourceOf(mapFile({ objects: { fog, tokens: TOKEN, pins: PIN } as never })), lit });

describe('player-safe refusal', () => {
  it('refuses 10,001 fog operations with a token under the last one, as live play clears', () => {
    const fog = crowdedFog();
    expect(Object.keys(fog)).toHaveLength(SCENE_LIMITS.records + 1);
    expect(Object.keys(fog).at(-1)).toBe('last');
    const source = sourceWith(fog);
    expect(playerSafeRefusal(source)).toBe(FOG_TRUNCATED_NOT_PLAYER_SAFE);
    expect(playerSafePayload(source, 'Inn', context)).toBeNull();
    expect(new FogCoverageCache().get(fog, createProjectionMemo()).truncated).toBe(true);
  });

  it('shares the same map once its fog fits, with the token and pin under the fog held back', () => {
    const fog = crowdedFog();
    delete fog.speck0;
    const payload = playerSafePayload(sourceWith(fog), 'Inn', context);
    expect(payload).not.toBeNull();
    expect(Object.keys(payload!.scene.tokens)).toEqual([]);
    expect(payload!.pins).toEqual([]);
  });

  it('refuses fog the projection drops (M1): an unknown type, or an id it refuses, unless it erases', () => {
    const unknownType = { odd: rect(400, 400, 200, 200, { type: 'cloud' as never }) };
    const longId = { ['x'.repeat(SCENE_LIMITS.idLength + 1)]: rect(400, 400, 200, 200) };
    const unreadable = { lasso: rect(0, 0, 0, 0, { type: 'lasso', points: [{ x: 'a' }] } as never) };
    for (const fog of [unknownType, longId, unreadable]) {
      expect(fogTruncated(fog, createProjectionMemo())).toBe(true);
      expect(playerSafePayload(sourceWith(fog), 'Inn', context)).toBeNull();
      expect(new FogCoverageCache().get(fog, createProjectionMemo()).truncated).toBe(true);
    }
    expect(fogTruncated({ odd: rect(400, 400, 200, 200, { type: 'cloud' as never, isErasing: true }) }, createProjectionMemo())).toBe(false);
  });

  it("does not count a lasso that covers nothing, as Atlas's own stroke draws none (a stray click must not blank play)", () => {
    const lasso = (points: unknown[]): Record<string, FogOperation> => ({ l: { id: 'l', kind: 'fog', type: 'lasso', timestamp: 1, isErasing: false, points } as FogOperation });
    // Two points, and three within the 1 px simplification of a line: no area on the GM's canvas either.
    expect(fogTruncated(lasso([{ x: 1, y: 1 }, { x: 5, y: 5 }]), createProjectionMemo())).toBe(false);
    expect(fogTruncated(lasso([{ x: 0, y: 0 }, { x: 50, y: 0.2 }, { x: 100, y: 0 }]), createProjectionMemo())).toBe(false);
    expect(new FogCoverageCache().get(lasso([{ x: 0, y: 0 }, { x: 50, y: 0.2 }, { x: 100, y: 0 }]), createProjectionMemo()).truncated).toBe(false);
    // A point that does not read still fails closed.
    expect(fogTruncated(lasso([{ x: 0, y: 0 }, { x: 'a', y: 1 }, { x: 100, y: 100 }]), createProjectionMemo())).toBe(true);
  });

  it('refuses a paint brush wider than the wire allows (M2), not an erasing one', () => {
    const brush = (isErasing: boolean): Record<string, FogOperation> =>
      ({ wide: { id: 'wide', kind: 'fog', type: 'brush', timestamp: 1, isErasing, brushRadius: 20_000, points: [{ x: 0, y: 0 }] } as FogOperation });
    expect(fogTruncated(brush(false), createProjectionMemo())).toBe(true);
    expect(fogTruncated(brush(true), createProjectionMemo())).toBe(false);
    expect(fogTruncated({ ok: { ...brush(false).wide!, brushRadius: 10_000 } as FogOperation }, createProjectionMemo())).toBe(false);
  });

  it('refuses a lit map, and one whose lighting Atlas did not say (M6)', async () => {
    expect(playerSafeRefusal(sourceWith({}, true))).toBe(LIT_MAP_NOT_PLAYER_SAFE);
    expect(playerSafeRefusal(sourceWith({}, null))).toBe(LIGHTING_UNKNOWN_NOT_PLAYER_SAFE);
    expect(playerSafePayload(sourceWith({}, null), 'Inn', context)).toBeNull();
    expect(playerSafeRefusal(sourceWith({}))).toBeNull();
    const saved = {
      background: null, grid: null, objects: { tokens: {}, texts: {}, drawings: {}, fog: {} },
      widgets: { settings: { widgets: {} }, values: {} }, initiative: null,
    };
    const read = await readSharedMap({ readMap: () => Promise.resolve(saved as never) }, 'Maps/Inn.atlasmap');
    expect(read?.lit).toBeNull();
  });

  it('clips long pin labels and icons to what a receiver takes (M5), never through a character', () => {
    const pins = { inn: { ...PIN.inn, label: 'L'.repeat(100), icon: 'i'.repeat(70) } };
    const payload = playerSafePayload({ ...sourceOf(mapFile({ objects: { pins } as never })), lit: false }, 'Inn', context)!;
    expect(payload.pins[0]?.label).toBe('L'.repeat(PIN_TEXT_LIMIT));
    expect(payload.pins[0]?.icon).toBe('i'.repeat(PIN_TEXT_LIMIT));
    expect(clippedPinText(`${'a'.repeat(63)}😀`)).toBe('a'.repeat(63));
  });
});
