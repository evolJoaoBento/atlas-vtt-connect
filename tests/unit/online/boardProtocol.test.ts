import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, PLAYER_MESSAGE_TYPES, type ControlMessage } from '../../../src/app/online/protocol';
import { BOARD_PART_LIMITS, type BoardExtras } from '../../../src/app/online/scene/boardTypes';

const extras = (overrides: Partial<BoardExtras> = {}): BoardExtras => ({
  sceneId: 's1',
  walls: [
    { id: 'w1', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, height: null, material: 'stone' },
    { id: 'd1', type: 'door', p1: { x: 70, y: 0 }, p2: { x: 140, y: 0 }, height: 2, material: null, door: { open: true, swing: 'left', prop: null } },
  ],
  lights: [{ id: 'l1', x: 35, y: 35, height: 1.5, color: '#ffaa00', bright: 20, dim: 40, intensity: 1, animation: 'torch', angle: null, rotation: 0, darkness: false, activeBelowAmbient: null }],
  props: [{ id: 'p1', asset: 'a'.repeat(64), x: 10, y: 10, scale: 1, turn: 0 }],
  materials: [{ id: 'stone', scale: 1, maps: { color: 'b'.repeat(64) } }],
  ambient: null,
  lighting: { enabled: true, ambient: 0.2, ambientColor: null },
  fogHeight: 2,
  ...overrides,
});

const roundTrip = (message: ControlMessage) => decodeControl(encodeControl(message));

describe('board messages', () => {
  it('round-trip board-offer, board-request, board-extras (in parts) and board-camera', () => {
    const messages: ControlMessage[] = [
      { v: 1, type: 'board-offer', available: true },
      { v: 1, type: 'board-request', on: false },
      { v: 1, type: 'board-extras', seq: 3, part: 0, parts: 2, extras: extras() },
      { v: 1, type: 'board-extras', seq: 4, part: 0, parts: 1, extras: null },
      { v: 1, type: 'board-camera', camera: { sceneId: 's1', eye: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 0, z: 6 } } },
      { v: 1, type: 'board-camera', camera: null },
    ];
    for (const message of messages) expect(roundTrip(message)).toEqual({ kind: 'message', message });
  });

  it('refuses extras with a non-finite point, too many walls in one part, or a part out of range', () => {
    const bad = (body: Record<string, unknown>) => decodeControl(JSON.stringify({ v: 1, type: 'board-extras', seq: 1, part: 0, parts: 1, extras: extras(), ...body })).kind;
    const nan = extras();
    (nan.walls[0]!.p1 as { x: unknown }).x = 'NaN';
    expect(bad({ extras: nan })).toBe('invalid');
    const many = extras({ walls: Array.from({ length: BOARD_PART_LIMITS.walls + 1 }, (_, i) => ({ id: `w${i}`, type: 'solid' as const, p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, height: null, material: null })) });
    expect(bad({ extras: many })).toBe('invalid');
    expect(bad({ part: 2, parts: 2 })).toBe('invalid');
    expect(bad({ parts: BOARD_PART_LIMITS.parts + 1 })).toBe('invalid');
    expect(bad({ extras: extras({ walls: [{ id: '__proto__', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 }, height: null, material: null }] }) })).toBe('invalid');
  });

  it('only board-request is something a player may send', () => {
    expect(PLAYER_MESSAGE_TYPES.has('board-request')).toBe(true);
    for (const type of ['board-offer', 'board-extras', 'board-camera'] as const) expect(PLAYER_MESSAGE_TYPES.has(type)).toBe(false);
  });

  it('an older page that does not know them ignores them instead of calling them broken', () => {
    const older = new Set(['ping', 'pong']);
    expect(decodeControl(encodeControl({ v: 1, type: 'board-offer', available: true }), older).kind).toBe('ignored');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'board-foo' })).kind).toBe('ignored');
  });
});
