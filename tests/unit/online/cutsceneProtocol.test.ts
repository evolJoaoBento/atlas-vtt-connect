import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, PLAYER_MESSAGE_TYPES, type ControlMessage } from '../../../src/app/online/protocol';
import type { BoardCutscene } from '../../../src/app/online/scene/boardTypes';
import { projectCutscene } from '../../../src/app/online/scene/projectCutscene';
import { createProjectionMemo } from '../../../src/app/online/scene/projectRecords';
import { BoardSessionHub } from '../../../src/app/online/tools/BoardSessionHub';
import { fakeAssetIds, snapshotOf } from './sceneFixtures';

const pose = { x: 1, y: 2, z: 3 };
const shot = (key: string, extra: Record<string, unknown> = {}) => ({ key, eye: pose, target: pose, at: 0, keyframe: false, transition: 'fade', ...extra });
const prepared = (extra: Record<string, unknown> = {}): BoardCutscene => ({
  runId: 'run-1', mode: 'prepared', look: { bars: 2.39, fadeMs: 600 }, shots: [shot('k1'), shot('k2', { at: 2000 })], step: { shot: 0, seq: 1 }, key: 'k1', ...extra,
}) as BoardCutscene;
const live = (extra: Record<string, unknown> = {}): BoardCutscene => ({ runId: 'run-2', mode: 'live', look: { bars: null, fadeMs: 600 }, shots: [], step: { shot: 0, seq: 1 }, key: 'k1', ...extra }) as BoardCutscene;

const roundTrip = (message: ControlMessage) => decodeControl(encodeControl(message));
const cutscene = (value: BoardCutscene | null) => roundTrip({ v: 1, type: 'cutscene', cutscene: value });

describe('cutscene messages', () => {
  const projected = projectCutscene(snapshotOf(), {
    settings: { getLocalPlayerViewSettings: () => ({ showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true }), onChange: () => () => undefined },
    assets: { ...fakeAssetIds(), onChange: () => () => undefined },
  }, null, 'cutscene:run-1:k1', createProjectionMemo());

  it('round-trips each message', () => {
    const messages: ControlMessage[] = [
      { v: 1, type: 'cutscene', cutscene: prepared() },
      { v: 1, type: 'cutscene', cutscene: null },
      { v: 1, type: 'cutscene-ready', on: true },
      { v: 1, type: 'cutscene-scene', runId: 'run-1', key: 'k1', scene: projected.scene },
      { v: 1, type: 'cutscene-extras', runId: 'run-1', key: 'k1', seq: 1, part: 0, parts: 1, extras: projected.extras },
      { v: 1, type: 'cutscene-camera', runId: 'run-2', eye: pose, target: pose },
    ];
    for (const message of messages) expect(roundTrip(message)).toEqual({ kind: 'message', message });
  });

  it('refuses a run with 201 shots, a key outside the pattern, or a negative time', () => {
    const many = Array.from({ length: 201 }, (_, i) => shot('k1', { at: i }));
    expect(cutscene(prepared({ shots: many })).kind).toBe('invalid');
    expect(cutscene(prepared({ shots: [shot('k/1')], key: 'k1' })).kind).toBe('invalid');
    expect(cutscene(prepared({ shots: [shot('k1', { at: -1 })] })).kind).toBe('invalid');
    expect(cutscene(prepared({ key: 'k/1' })).kind).toBe('invalid');
  });

  it('keeps to the limits of the time, the coordinates, the fade and the bars', () => {
    expect(cutscene(prepared({ shots: [shot('k1', { at: 3_600_000 })] })).kind).toBe('message');
    expect(cutscene(prepared({ shots: [shot('k1', { at: 3_600_001 })] })).kind).toBe('invalid');
    expect(cutscene(prepared({ shots: [shot('k1', { eye: { x: 1e7, y: 0, z: 0 } })] })).kind).toBe('message');
    expect(cutscene(prepared({ shots: [shot('k1', { eye: { x: 1e7 + 1, y: 0, z: 0 } })] })).kind).toBe('invalid');
    expect(cutscene(prepared({ shots: [shot('k1', { target: { x: 0, y: -1e8, z: 0 } })] })).kind).toBe('invalid');
    expect(cutscene(prepared({ look: { bars: 2.39, fadeMs: 99 } })).kind).toBe('invalid');
    expect(cutscene(prepared({ look: { bars: 2.39, fadeMs: 3001 } })).kind).toBe('invalid');
    expect(cutscene(prepared({ look: { bars: 2.39, fadeMs: 3000 } })).kind).toBe('message');
    expect(cutscene(prepared({ look: { bars: 1.5, fadeMs: 600 } })).kind).toBe('invalid');
    for (const bars of [null, 1.85, 2, 2.39]) expect(cutscene(prepared({ look: { bars, fadeMs: 600 } })).kind).toBe('message');
  });

  it('accepts a live run with no shots and refuses a prepared one with none', () => {
    expect(cutscene(live()).kind).toBe('message');
    expect(cutscene(prepared({ shots: [] })).kind).toBe('invalid');
  });

  it('refuses a camera or a shot beyond the coordinate limit', () => {
    expect(roundTrip({ v: 1, type: 'cutscene-camera', runId: 'run-2', eye: { x: 1e8, y: 0, z: 0 }, target: pose }).kind).toBe('invalid');
  });

  it('is told to the scene hub only when the session carries cutscenes', () => {
    const options = { projection: { shownSlot: () => null, onSlotChange: () => () => undefined } as never, handouts: { current: () => null, subscribe: () => () => undefined }, coneAngle: () => 90 };
    expect(new BoardSessionHub({ ...options, cutscenes: false }).cutscenes).toBeUndefined();
    expect(new BoardSessionHub({ ...options, cutscenes: true }).cutscenes).toBe(true);
  });

  it('lets a player send cutscene-ready and nothing else of the cutscene messages', () => {
    expect(PLAYER_MESSAGE_TYPES.has('cutscene-ready')).toBe(true);
    for (const type of ['cutscene', 'cutscene-scene', 'cutscene-extras', 'cutscene-camera'] as const) expect(PLAYER_MESSAGE_TYPES.has(type)).toBe(false);
  });
});
