import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { TemplateHost } from '../../../src/app/online/tools/TemplateHost';
import { isSpell, SPELL_LIMITS, type MapSpell, type Spell } from '../../../src/app/online/tools/spells';

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
const BEN: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };
const cone: Spell = { shape: 'cone', from: 'self', at: { x: 385, y: 385, h: 40 }, yaw: -1.57, pitch: -0.1, roll: 0, size: 280, length: 0, angle: 0.93, caster: 'mine' };
const cast = (spell: Spell = cone) => ({ v: 1 as const, type: 'map-spell' as const, sceneId: 's1', add: spell });

function world() {
  const sent: Array<[string, ControlMessage]> = [];
  let handler: SessionHandler | null = null;
  const board = { templatesChanged: vi.fn() };
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const host = new TemplateHost({
    session: { use: (h: SessionHandler) => { handler = h; return () => undefined; }, send: (id: string, m: ControlMessage) => { sent.push([id, m]); }, getPlayers: () => [ANA, BEN] } as never,
    projection: {
      slotOf: () => ({ sceneId: 's1', lastSent: {}, tab: { viewId: 'v1' }, mapPath: 'm' }),
      audience: () => ['p1', 'p2'],
      shownSlot: () => ({ sceneId: 's1', tab: { viewId: 'v1' }, mapPath: 'm' }),
      onSlotChange: () => () => undefined,
    } as never,
    board,
  });
  host.start();
  const last = (playerId: string): MapSpell[] => {
    const message = sent.filter(([to, m]) => to === playerId && m.type === 'map-spells').at(-1)?.[1] as Extract<ControlMessage, { type: 'map-spells' }> | undefined;
    return message?.spells ?? [];
  };
  return { host, board, sent, last, send: (player: SessionPlayer, message: ControlMessage) => handler!.onMessage?.(player, message), tick: () => { now += 1000; } };
}

describe('spells cast through a token\'s eyes', () => {
  it('are kept per scene with their caster and colour, sent to everyone on it, and the GM\'s board is told', () => {
    const w = world();
    w.send(ANA, cast());
    expect(w.last('p2')).toEqual([{ id: 's1', owner: 'p1', color: expect.stringMatching(/^#[0-9a-f]{6}$/i), spell: cone }]);
    expect(w.last('p1')).toHaveLength(1);
    expect(w.board.templatesChanged).toHaveBeenCalled();
    expect(w.host.spellsFor('s1')).toHaveLength(1);
  });

  it('can be taken off only by their caster, all of theirs at once, or by the GM', () => {
    const w = world();
    w.send(ANA, cast());
    w.send(ANA, cast({ ...cone, shape: 'sphere' }));
    w.send(BEN, { v: 1, type: 'map-spell', sceneId: 's1', remove: 's1' });
    expect(w.last('p1')).toHaveLength(2);
    w.tick();
    w.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', remove: 's1' });
    expect(w.last('p1').map((spell) => spell.id)).toEqual(['s2']);
    w.host.eraseSpell('s1', 's2');
    expect(w.last('p2')).toEqual([]);
    w.tick();
    w.send(ANA, cast());
    w.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', clear: true });
    expect(w.last('p2')).toEqual([]);
  });

  it('are limited per player and per second, and go with a player who leaves', () => {
    const w = world();
    for (let i = 0; i < SPELL_LIMITS.perPlayer + 3; i++) { w.tick(); w.send(ANA, cast()); }
    expect(w.last('p1')).toHaveLength(SPELL_LIMITS.perPlayer);
    for (let i = 0; i < 10; i++) w.send(BEN, cast());
    expect(w.last('p1').filter((spell) => spell.owner === 'p2')).toHaveLength(SPELL_LIMITS.perSecond);
    w.host.playersChanged([BEN]);
    expect(w.last('p2').every((spell) => spell.owner === 'p2')).toBe(true);
  });

  it('the GM\'s clear takes spells off with the templates', () => {
    const w = world();
    w.send(ANA, cast());
    expect(w.host.hasAny()).toBe(true);
    w.host.clear();
    expect(w.last('p1')).toEqual([]);
    expect(w.host.hasAny()).toBe(false);
  });

  it('a newly admitted player is sent the scene\'s spells', () => {
    const w = world();
    w.send(ANA, cast());
    w.host.onAdmitted(BEN);
    expect(w.sent.at(-1)).toEqual(['p2', expect.objectContaining({ type: 'map-spells', spells: [expect.objectContaining({ id: 's1' })] })]);
  });
});

describe('spell messages', () => {
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
    const list = encodeControl({ v: 1, type: 'map-spells', sceneId: 's1', spells: [] });
    expect(decodeControl(list, new Set(['map-templates'])).kind).toBe('ignored');
  });
});
