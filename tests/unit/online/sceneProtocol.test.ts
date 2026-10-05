import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { diffScenes } from '../../../src/app/online/scene/sceneDiff';
import { SCENE_LIMITS } from '../../../src/app/online/scene/sceneLimits';
import { sortedByOrder } from '../../../src/app/online/scene/sceneTypes';
import { fogRect, playerScene, playerToken, sceneBody } from './sceneFixtures';

const decodeRaw = (value: unknown): ReturnType<typeof decodeControl> => decodeControl(JSON.stringify(value));

describe('scene messages', () => {
  it('round-trips every scene message type', () => {
    const scene = playerScene();
    const messages: ControlMessage[] = [
      { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 1, drawingParts: 1 },
      { v: 1, type: 'scene-fog', seq: 2, part: 0, records: scene.fog },
      { v: 1, type: 'scene-drawings', seq: 3, part: 0, records: scene.drawings },
      {
        v: 1, type: 'scene-patch', seq: 3,
        set: { grid: null, widgets: [] },
        upsert: { tokens: { t2: playerToken({ x: 5 }) }, fog: { f2: fogRect(2, { erase: true }) } },
        remove: { texts: ['x1'] },
      },
      { v: 1, type: 'scene-clear', seq: 4 },
      { v: 1, type: 'scene-resync', seq: 0 },
    ];
    for (const message of messages) {
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('accepts every fog operation shape and rejects broken ones', () => {
    const records = {
      brush: { type: 'brush', erase: false, order: 1, radius: 20, points: [{ x: 0, y: 0 }] },
      lasso: { type: 'lasso', erase: true, order: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
      rect: fogRect(3),
    };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records }).kind).toBe('message');
    const broken = [
      { type: 'brush', erase: false, order: 1, radius: 20, points: [] },
      { type: 'brush', erase: false, order: 1, radius: 0, points: [{ x: 0, y: 0 }] },
      { type: 'lasso', erase: false, order: 1, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
      { type: 'rectangle', erase: false, order: 1, x: 0, y: 0, width: 'wide', height: 5 },
      { type: 'circle', erase: false, order: 1 },
    ];
    for (const op of broken) {
      expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: { a: op } }))
        .toEqual({ kind: 'invalid', reason: 'bad-scene-fog' });
    }
  });

  it('checks drawing parts like fog parts', () => {
    const drawings = playerScene().drawings;
    expect(decodeRaw({ v: 1, type: 'scene-drawings', seq: 1, part: 0, records: drawings }).kind).toBe('message');
    const bad = { d: { type: 'pen', order: 1, points: [], color: '#000000', width: 1, opacity: 1, icon: null } };
    expect(decodeRaw({ v: 1, type: 'scene-drawings', seq: 1, part: 0, records: bad }))
      .toEqual({ kind: 'invalid', reason: 'bad-scene-drawings' });
  });

  it('rejects a snapshot with a malformed record or a missing field', () => {
    const body = sceneBody(playerScene());
    const badToken = { ...body, tokens: { t1: { ...playerToken(), hp: { current: 'lots', max: 10 } } } };
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: badToken, fogParts: 0, drawingParts: 0 }))
      .toEqual({ kind: 'invalid', reason: 'bad-scene-snapshot' });
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: 0 }).kind).toBe('invalid');
    const { grid: _grid, ...withoutGrid } = body;
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: withoutGrid, fogParts: 0, drawingParts: 0 }).kind).toBe('invalid');
  });

  it('refuses record ids that assignment would treat specially', () => {
    const raw = `{"v":1,"type":"scene-fog","seq":1,"part":0,"records":{"__proto__":${JSON.stringify(fogRect(1))}}}`;
    expect(decodeControl(raw)).toEqual({ kind: 'invalid', reason: 'bad-scene-fog' });
    const patch = { v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: {}, remove: { tokens: ['constructor'] } };
    expect(decodeRaw(patch)).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
  });

  it('bounds sequence numbers and sizes', () => {
    expect(decodeRaw({ v: 1, type: 'scene-clear', seq: 0 }).kind).toBe('invalid');
    expect(decodeRaw({ v: 1, type: 'scene-clear', seq: 1.5 }).kind).toBe('invalid');
    expect(decodeRaw({ v: 1, type: 'scene-resync', seq: -1 }).kind).toBe('invalid');
    const points = Array.from({ length: SCENE_LIMITS.points + 1 }, (_, i) => ({ x: i, y: 0 }));
    const op = { type: 'brush', erase: false, order: 1, radius: 5, points };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: { a: op } }).kind).toBe('invalid');
  });

  it('checks only the patch fields it knows, so newer GMs can add fields', () => {
    const patch = { v: 1, type: 'scene-patch', seq: 2, set: { lighting: { any: 'thing' } }, upsert: { walls: {} }, remove: {} };
    expect(decodeRaw(patch).kind).toBe('message');
    const badUpsert = { v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: { tokens: { t1: { x: 1 } } }, remove: {} };
    expect(decodeRaw(badUpsert)).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
    const badSet = { v: 1, type: 'scene-patch', seq: 2, set: { map: { asset: null } }, upsert: {}, remove: {} };
    expect(decodeRaw(badSet)).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
  });

  it('orders fog and drawings by order, then by id', () => {
    const records = { b: { order: 1 }, a: { order: 1 }, c: { order: 0 } };
    expect(sortedByOrder(records, (record) => record.order).map(([id]) => id)).toEqual(['c', 'a', 'b']);
  });
});

describe('scene value bounds', () => {
  const snapshot = (scene: unknown): ReturnType<typeof decodeControl> =>
    decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene, fogParts: 0, drawingParts: 0 });
  const body = sceneBody(playerScene());
  const withGrid = (overrides: object): unknown => ({ ...body, grid: { ...body.grid, ...overrides } });
  const withMap = (overrides: object): unknown => ({ ...body, map: { ...body.map, ...overrides } });
  const withToken = (overrides: object): unknown => ({ ...body, tokens: { t1: { ...playerToken(), ...overrides } } });
  const withText = (overrides: object): unknown => ({ ...body, texts: { x1: { ...body.texts.x1, ...overrides } } });
  const valid = (result: ReturnType<typeof decodeControl>): boolean => result.kind === 'message';

  it('holds numbers to their ranges, just inside and just outside', () => {
    expect(valid(snapshot(withGrid({ size: 1 })))).toBe(true);
    expect(valid(snapshot(withGrid({ size: 10_000 })))).toBe(true);
    expect(valid(snapshot(withGrid({ size: 0.999 })))).toBe(false);
    expect(valid(snapshot(withGrid({ size: 1e-300 })))).toBe(false);
    expect(valid(snapshot(withGrid({ size: 10_001 })))).toBe(false);
    expect(valid(snapshot(withMap({ cellSize: 1 })))).toBe(true);
    expect(valid(snapshot(withMap({ cellSize: 0.5 })))).toBe(false);
    expect(valid(snapshot(withMap({ cellSize: 10_001 })))).toBe(false);
    expect(valid(snapshot(withMap({ width: 200_000 })))).toBe(true);
    expect(valid(snapshot(withMap({ width: 200_001 })))).toBe(false);
    expect(valid(snapshot(withToken({ x: 10_000_000 })))).toBe(true);
    expect(valid(snapshot(withToken({ x: -10_000_001 })))).toBe(false);
    expect(valid(snapshot(withToken({ size: 0.05 })))).toBe(true);
    expect(valid(snapshot(withToken({ size: 0.04 })))).toBe(false);
    expect(valid(snapshot(withToken({ size: 100.5 })))).toBe(false);
    expect(valid(snapshot(withText({ fontSize: 1 })))).toBe(true);
    expect(valid(snapshot(withText({ fontSize: 0.5 })))).toBe(false);
    expect(valid(snapshot(withText({ fontSize: 1001 })))).toBe(false);
    expect(valid(snapshot(withText({ scale: 0.01 })))).toBe(true);
    expect(valid(snapshot(withText({ scale: 0.009 })))).toBe(false);
    expect(valid(snapshot(withText({ scale: 101 })))).toBe(false);
    expect(valid(snapshot(withText({ opacity: 1 })))).toBe(true);
    expect(valid(snapshot(withText({ opacity: 1.1 })))).toBe(false);
    expect(valid(snapshot(withText({ width: 200_001 })))).toBe(false);
    expect(valid(snapshot(withGrid({ opacity: -0.1 })))).toBe(false);
    expect(valid(snapshot(withGrid({ lineWidth: 10_001 })))).toBe(false);
  });

  it('refuses points, fog and drawings out of range', () => {
    const far = { x: 10_000_001, y: 0 };
    const brush = { type: 'brush', erase: false, order: 1, radius: 10_001, points: [{ x: 0, y: 0 }] };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: { a: brush } }).kind).toBe('invalid');
    const lasso = { type: 'lasso', erase: false, order: 1, points: [far, { x: 0, y: 0 }, { x: 1, y: 1 }] };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: { a: lasso } }).kind).toBe('invalid');
    const pen = { type: 'pen', order: 1, points: [far], color: '#000000', width: 1, opacity: 1, icon: null };
    expect(decodeRaw({ v: 1, type: 'scene-drawings', seq: 1, part: 0, records: { a: pen } }).kind).toBe('invalid');
    const wide = { ...pen, points: [{ x: 1, y: 1 }], width: 10_001 };
    expect(decodeRaw({ v: 1, type: 'scene-drawings', seq: 1, part: 0, records: { a: wide } }).kind).toBe('invalid');
  });

  it('refuses numbers that parse to Infinity', () => {
    const raw = JSON.stringify({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: 0, drawingParts: 0 })
      .replace('"cellSize":70', '"cellSize":1e999');
    expect(raw).toContain('1e999');
    expect(decodeControl(raw)).toEqual({ kind: 'invalid', reason: 'bad-scene-snapshot' });
    const rect = JSON.stringify(fogRect(1)).replace('"x":0', '"x":1e999');
    expect(decodeControl(`{"v":1,"type":"scene-fog","seq":1,"part":0,"records":{"a":${rect}}}`).kind).toBe('invalid');
  });

  it('tolerates keys it does not know, so newer GMs can add fields', () => {
    expect(valid(snapshot(withToken({ isHidden: true })))).toBe(true);
  });

  it('checks the measurement settings, which every snapshot carries', () => {
    const withMeasurement = (overrides: object): unknown => ({ ...body, measurement: { ...body.measurement, ...overrides } });
    expect(valid(snapshot(withMeasurement({ unitDistance: 1_000_000 })))).toBe(true);
    expect(valid(snapshot(withMeasurement({ unitDistance: -1 })))).toBe(false);
    expect(valid(snapshot(withMeasurement({ ruleDistance: -1 })))).toBe(false);
    expect(valid(snapshot(withMeasurement({ ruleDistance: '5' })))).toBe(false);
    const { ruleDistance: _rule, ...noRule } = body.measurement;
    expect(valid(snapshot({ ...body, measurement: noRule }))).toBe(true);
    expect(valid(snapshot(withMeasurement({ unitType: 'furlongs' })))).toBe(false);
    expect(valid(snapshot(withMeasurement({ diagonalRule: 'taxicab' })))).toBe(false);
    expect(valid(snapshot(withMeasurement({ rangeBands: [{ name: 'Near', maxSquares: 0 }] })))).toBe(false);
    expect(valid(snapshot(withMeasurement({ rangeBands: Array.from({ length: 33 }, () => ({ name: 'Near', maxSquares: 1 })) })))).toBe(false);
    const { measurement: _measurement, ...withoutMeasurement } = body;
    // An older GM sends none (the mirror fills it in); a bad one is refused.
    expect(valid(snapshot(withoutMeasurement))).toBe(true);
    expect(valid(snapshot({ ...body, measurement: null }))).toBe(false);
    expect(valid(snapshot(withMeasurement({ snapToGrid: 'yes' })))).toBe(false);
    const { snapToGrid: _snap, coneAngle: _cone, ...olderMeasurement } = body.measurement;
    expect(valid(snapshot({ ...body, measurement: olderMeasurement }))).toBe(true);
    expect(valid(snapshot(withMeasurement({ coneAngle: 53.13 })))).toBe(true);
    expect(valid(snapshot(withMeasurement({ coneAngle: 360 })))).toBe(true);
    for (const coneAngle of [0, 361, Number.NaN, '90', null]) expect(valid(snapshot(withMeasurement({ coneAngle })))).toBe(false);
  });

  it('patches a changed measurement as a whole', () => {
    const previous = playerScene();
    const next = playerScene({ measurement: { ...previous.measurement, unitDistance: 10 } });
    expect(diffScenes(previous, next)?.set).toEqual({ measurement: next.measurement });
  });
});

describe('scene limits', () => {
  const body = sceneBody(playerScene());

  it('refuses ids that assignment treats specially in snapshots and patches', () => {
    const snapshot = JSON.stringify({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: 0, drawingParts: 0 });
    const patch = JSON.stringify({
      v: 1, type: 'scene-patch', seq: 2, set: {}, remove: {}, upsert: { tokens: { t1: playerToken() } },
    });
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      expect(decodeControl(snapshot).kind).toBe('message');
      expect(decodeControl(snapshot.replace('"t1"', `"${id}"`))).toEqual({ kind: 'invalid', reason: 'bad-scene-snapshot' });
      expect(decodeControl(snapshot.replace('"x1"', `"${id}"`))).toEqual({ kind: 'invalid', reason: 'bad-scene-snapshot' });
      expect(decodeControl(patch.replace('"t1"', `"${id}"`))).toEqual({ kind: 'invalid', reason: 'bad-scene-patch' });
    }
  });

  it('refuses too many records, oversize ids and oversize strings', () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i <= SCENE_LIMITS.records; i++) many[`f${i}`] = fogRect(i);
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: many }).kind).toBe('invalid');
    const long = { ['i'.repeat(SCENE_LIMITS.idLength + 1)]: fogRect(1) };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: long }).kind).toBe('invalid');
    const okId = { ['i'.repeat(SCENE_LIMITS.idLength)]: fogRect(1) };
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: 0, records: okId }).kind).toBe('message');
    const scene = { ...body, tokens: { t1: playerToken({ name: 'n'.repeat(SCENE_LIMITS.stringLength + 1) }) } };
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene, fogParts: 0, drawingParts: 0 }))
      .toEqual({ kind: 'invalid', reason: 'bad-scene-snapshot' });
  });

  it('refuses part counts above the limit', () => {
    const tooMany = SCENE_LIMITS.records + 1;
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: tooMany, drawingParts: 0 }).kind).toBe('invalid');
    expect(decodeRaw({ v: 1, type: 'scene-snapshot', seq: 1, scene: body, fogParts: 0, drawingParts: tooMany }).kind).toBe('invalid');
    expect(decodeRaw({ v: 1, type: 'scene-fog', seq: 1, part: tooMany, records: {} }).kind).toBe('invalid');
    expect(decodeRaw({ v: 1, type: 'scene-drawings', seq: 1, part: tooMany, records: {} }).kind).toBe('invalid');
  });

  it('refuses too many widgets and initiative entries', () => {
    const widget = { id: 'w', type: 'counter', label: 'L', icon: 'i', value: 1 };
    const widgets = Array.from({ length: SCENE_LIMITS.widgets + 1 }, () => widget);
    const patch = { v: 1, type: 'scene-patch', seq: 2, upsert: {}, remove: {} };
    expect(decodeRaw({ ...patch, set: { widgets } }).kind).toBe('invalid');
    expect(decodeRaw({ ...patch, set: { widgets: widgets.slice(1) } }).kind).toBe('message');
    const entry = { id: 'e', tokenId: 't', initiative: 1, name: null, hp: null, isActive: false };
    const entries = Array.from({ length: SCENE_LIMITS.initiativeEntries + 1 }, () => entry);
    expect(decodeRaw({ ...patch, set: { initiative: { round: 1, active: true, entries } } }).kind).toBe('invalid');
    const fits = { round: 1, active: true, entries: entries.slice(1) };
    expect(decodeRaw({ ...patch, set: { initiative: fits } }).kind).toBe('message');
  });

  describe('token resources', () => {
    const patchWith = (token: object): ReturnType<typeof decodeControl> => decodeRaw({
      v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: { tokens: { t1: token } }, remove: {},
    });
    const bar = { color: '#22c55e', share: 0.5, spent: false };
    const tokenWith = (extra: object): object => ({ ...playerToken(), ...extra });

    it('accepts bars and the downed mark, and a token from before them', () => {
      expect(patchWith(tokenWith({ resources: [bar, { ...bar, color: '#A855F7', share: 0, spent: true }], downed: true })).kind).toBe('message');
      expect(patchWith(playerToken()).kind).toBe('message');
      // A GM of an older version sent no bars and an HP bar of its own, which is still validated
      const { resources: _resources, ...older } = tokenWith({ hp: { current: 3, max: 8 }, stress: null }) as Record<string, unknown>;
      expect(patchWith(older).kind).toBe('message');
      const { hp: _hp, stress: _stress, ...without } = playerToken() as unknown as Record<string, unknown>;
      expect(patchWith(without).kind).toBe('message');
    });

    it('refuses malformed bars: the colour, the share, the flag, the count and the type', () => {
      const bad = [
        [{ ...bar, color: 'red' }], [{ ...bar, color: 'url(x)' }], [{ ...bar, color: '#12345' }], [{ ...bar, color: '#22c55e00' }], [{ ...bar, color: 5 }],
        [{ ...bar, share: 1.01 }], [{ ...bar, share: -0.1 }], [{ ...bar, share: Number.NaN }], [{ ...bar, share: '0.5' }],
        [{ ...bar, spent: 1 }], [{ color: bar.color, share: bar.share }], ['bar'], [null], { 0: bar }, 'bars',
        Array.from({ length: SCENE_LIMITS.resources + 1 }, () => bar),
      ];
      for (const resources of bad) expect(patchWith(tokenWith({ resources })).kind, JSON.stringify(resources)).toBe('invalid');
      expect(patchWith(tokenWith({ resources: Array.from({ length: SCENE_LIMITS.resources }, () => bar) })).kind).toBe('message');
      expect(patchWith(tokenWith({ downed: 'yes' })).kind).toBe('invalid');
    });

    it('checks the initiative bar: a share from 0 to 1, or none', () => {
      const entry = { id: 'e', tokenId: 't', initiative: 1, name: null, hp: null, isActive: false };
      const initiative = (extra: object): object => ({ round: 1, active: true, entries: [{ ...entry, ...extra }] });
      const patch = (value: object): ReturnType<typeof decodeControl> => decodeRaw({ v: 1, type: 'scene-patch', seq: 2, upsert: {}, remove: {}, set: { initiative: value } });
      for (const ok of [{}, { hpShare: null }, { hpShare: 0 }, { hpShare: 1 }, { hpShare: 0.4 }]) expect(patch(initiative(ok)).kind).toBe('message');
      for (const bad of [{ hpShare: 1.5 }, { hpShare: -1 }, { hpShare: '1' }]) expect(patch(initiative(bad)).kind).toBe('invalid');
    });

    it('checks initiative by sides: the sides, an entry that sits out and a token\'s side, all optional', () => {
      const entry = { id: 'e', tokenId: 't', initiative: 0, name: null, hp: null, isActive: false };
      const list = (value: object, entryExtra: object = {}): object => ({ round: 1, active: true, entries: [{ ...entry, ...entryExtra }], ...value });
      const patch = (initiative: object, tokens: object = {}): ReturnType<typeof decodeControl> => decodeRaw({
        v: 1, type: 'scene-patch', seq: 2, upsert: { tokens }, remove: {}, set: { initiative },
      });
      // Older GMs send none of them
      expect(patch(list({})).kind).toBe('message');
      for (const sides of [{ first: 'players' }, { first: 'opponents', active: 'players' }, { first: 'players', active: 'opponents' }]) {
        expect(patch(list({ sides })).kind, JSON.stringify(sides)).toBe('message');
      }
      for (const sides of [{}, { first: 'monsters' }, { first: 'players', active: 'both' }, { first: 'players', active: null }, 'players', null, []]) {
        expect(patch(list({ sides })).kind, JSON.stringify(sides)).toBe('invalid');
      }
      expect(patch(list({}, { sitsOut: true })).kind).toBe('message');
      for (const sitsOut of [false, 1, 'true', null]) expect(patch(list({}, { sitsOut })).kind, String(sitsOut)).toBe('invalid');
      expect(patch(list({}), { t: { ...playerToken(), side: 'opponents' } }).kind).toBe('message');
      for (const side of ['both', '', 1, null]) expect(patch(list({}), { t: { ...playerToken(), side } }).kind, String(side)).toBe('invalid');
    });
  });
});
