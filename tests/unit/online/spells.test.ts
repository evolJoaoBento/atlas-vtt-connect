import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { cleanSpell, isSpell, SPELL_LIMITS, type Spell } from '../../../src/app/online/tools/spells';

const cone: Spell = { shape: 'cone', from: 'self', at: { x: 385, y: 385, h: 40 }, yaw: -1.57, pitch: -0.1, roll: 0, size: 280, length: 0, angle: 0.93, caster: 'mine' };
const cast = (spell: Spell = cone) => ({ v: 1 as const, type: 'map-spell' as const, sceneId: 's1', add: spell });

// How casts are kept (in Atlas's measures) is pinned by measureHost.test.ts.
describe('spell messages', () => {
  it('a spell may carry one of the damage types, kept as cast; an unknown one does not decode', () => {
    expect(isSpell({ ...cone, effect: 'fire' })).toBe(true);
    expect(isSpell({ ...cone, effect: 'glitter' })).toBe(false);
    expect(cleanSpell({ ...cone, effect: 'necrotic' }).effect).toBe('necrotic');
  });

  it('a well formed spell decodes; an unknown shape, a bad size or a stray field does not', () => {
    expect(decodeControl(encodeControl(cast()))).toEqual({ kind: 'message', message: cast() });
    const wall: Spell = { ...cone, shape: 'wall', from: 'point', to: { x: 455, y: 385 }, size: 14, length: 140 };
    expect(isSpell(wall)).toBe(true);
    expect(isSpell({ ...wall, to: undefined })).toBe(false);
    expect(isSpell({ ...cone, shape: 'torus' })).toBe(false);
    expect(isSpell({ ...cone, size: -1 })).toBe(false);
    expect(isSpell({ ...cone, size: SPELL_LIMITS.maxSize + 1 })).toBe(false);
    expect(isSpell({ ...cone, script: 'x' })).toBe(false);
    expect(isSpell({ ...cone, shape: 'cylinder' })).toBe(false);
    expect(decodeControl(JSON.stringify({ ...cast(), add: { ...cone, angle: 4 } })).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'map-spell', sceneId: 's1', add: cone, clear: true })).kind).toBe('invalid');
  });

  it("what Tabletop's board sends (a cone, a clear, a cube, a wall, as its harness recorded) decodes", () => {
    const changes = [{"add":{"shape":"cone","from":"self","yaw":-1.5707963267948966,"pitch":-0.15,"roll":0,"size":280,"length":0,"angle":0.9250245035569946,"caster":"mine","at":{"x":385,"y":385,"h":71.69475899086663}}},{"clear":true},{"add":{"shape":"cube","from":"point","yaw":-1.3089969389957474,"pitch":0,"roll":0,"size":280,"length":0,"angle":0.9250245035569946,"caster":"mine","at":{"x":859.3749333342902,"y":385,"h":35}}},{"add":{"shape":"wall","from":"point","yaw":0,"pitch":0,"roll":0,"size":280,"length":280,"angle":0.9250245035569946,"caster":"mine","at":{"x":859.3749333342902,"y":385,"h":0},"to":{"x":791.5557691928715,"y":367.66330552961983}}}] as Array<Record<string, unknown>>;
    for (const change of changes) expect(decodeControl(encodeControl({ v: 1, type: 'map-spell', sceneId: 's1', ...change } as ControlMessage)).kind).toBe('message');
  });

  it('an older page, which knows no spells, ignores them', () => {
    const list = encodeControl({ v: 1, type: 'spell-asks', sceneId: 's1', asks: [] });
    expect(decodeControl(list, new Set(['map-templates'])).kind).toBe('ignored');
  });
});
