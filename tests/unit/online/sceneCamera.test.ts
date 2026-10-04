import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { cameraOfMessage, roundedCamera, sameCamera, type SceneCamera } from '../../../src/app/online/scene/sceneCamera';

const camera = (overrides: Partial<SceneCamera> = {}): SceneCamera => ({
  sceneId: 'scene-1', centerX: 500, centerY: 400, width: 800, height: 600, ...overrides,
});
const raw = (overrides: Record<string, unknown> = {}): string => JSON.stringify({ v: 1, type: 'scene-camera', ...camera(), ...overrides });

describe('scene-camera messages', () => {
  it('round-trips a camera', () => {
    const message: ControlMessage = { v: 1, type: 'scene-camera', ...camera() };
    expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
  });

  it('accepts negative centres and the edges of the coordinate range', () => {
    for (const fields of [{ centerX: -10_000_000 }, { centerY: 10_000_000 }, { width: 10_000_000, height: 0.01 }]) {
      expect(decodeControl(raw(fields)).kind).toBe('message');
    }
  });

  it('refuses a camera out of range, without a positive size, or with a bad scene id', () => {
    const bad = [
      { width: 0 }, { height: -5 }, { width: 10_000_001 }, { centerX: 1e8 }, { centerY: 'x' }, { centerX: null },
      { sceneId: '' }, { sceneId: '__proto__' }, { sceneId: 5 }, { height: undefined },
    ];
    for (const fields of bad) expect(decodeControl(raw(fields)), JSON.stringify(fields)).toEqual({ kind: 'invalid', reason: 'bad-scene-camera' });
  });

  it('keeps only the camera fields of a message', () => {
    expect(cameraOfMessage({ ...camera(), extra: 'x' } as SceneCamera)).toEqual(camera());
  });

  it('rounds to hundredths of a world unit and compares by value', () => {
    const rounded = roundedCamera(camera({ centerX: 500.123, centerY: 399.996, width: 800.006, height: 0.001 }));
    expect(rounded).toEqual(camera({ centerX: 500.12, centerY: 400, width: 800.01, height: 0.01 }));
    expect(sameCamera(rounded, { ...rounded })).toBe(true);
    expect(sameCamera(rounded, { ...rounded, sceneId: 'scene-2' })).toBe(false);
    expect(sameCamera(null, null)).toBe(true);
    expect(sameCamera(rounded, null)).toBe(false);
  });
});
