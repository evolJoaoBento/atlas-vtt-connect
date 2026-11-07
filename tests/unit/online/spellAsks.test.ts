import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { TemplateHost } from '../../../src/app/online/tools/TemplateHost';
import { askedSpell, isSpellAsk, type Spell, type SpellAsk, type SpellRequest } from '../../../src/app/online/tools/spells';

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
const BEN: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };
const CARA: SessionPlayer = { playerId: 'p3', name: 'Cara', status: 'admitted' };
const fireball: SpellAsk = { name: 'Fireball', shape: 'sphere', from: 'point', size: 280, length: 0 };
const aimed: Spell = { shape: 'cube', from: 'self', at: { x: 400, y: 300, h: 10 }, yaw: 0.5, pitch: 0.1, roll: 0, size: 9999, length: 50, angle: 0.93, caster: 'other' };

function world() {
  const sent: Array<[string, ControlMessage]> = [];
  let handler: SessionHandler | null = null;
  vi.spyOn(Date, 'now').mockImplementation(() => 0);
  const host = new TemplateHost({
    session: { use: (h: SessionHandler) => { handler = h; return () => undefined; }, send: (id: string, m: ControlMessage) => { sent.push([id, m]); }, getPlayers: () => [ANA, BEN, CARA] } as never,
    projection: {
      slotOf: () => ({ sceneId: 's1', lastSent: {}, tab: { viewId: 'v1' }, mapPath: 'm' }),
      audience: () => ['p1', 'p2', 'p3'],
      shownSlot: () => ({ sceneId: 's1', tab: { viewId: 'v1' }, mapPath: 'm' }),
      onSlotChange: () => () => undefined,
    } as never,
  });
  // Ana and Ben control the wizard; Cara controls nothing.
  const control = new Map([['wizard', new Set(['p1', 'p2'])]]);
  const notify = vi.fn();
  host.useAsks({ controls: (playerId, tokenId) => control.get(tokenId)?.has(playerId) ?? false, notify });
  host.start();
  const lastOf = (playerId: string) => sent.filter(([to, m]) => to === playerId && m.type === 'map-spells').at(-1)?.[1] as Extract<ControlMessage, { type: 'map-spells' }> | undefined;
  const asks = (playerId: string): SpellRequest[] => lastOf(playerId)?.asks ?? [];
  return {
    host, sent, notify, control, asks,
    send: (player: SessionPlayer, message: ControlMessage) => handler!.onMessage?.(player, message),
    admit: (player: SessionPlayer) => handler!.onAdmitted?.(player),
  };
}

describe('spells the GM asks of a token', () => {
  it("go to the token's players on the scene, and only to them", () => {
    const w = world();
    expect(w.host.requestSpell('s1', 'wizard', fireball)).toBe(2);
    expect(w.asks('p1')).toEqual([{ id: 'a1', tokenId: 'wizard', ask: fireball }]);
    expect(w.asks('p2')).toHaveLength(1);
    expect(w.asks('p3')).toEqual([]);
    expect(w.host.requestOf('s1', 'wizard')).toEqual(fireball);
  });

  it('a new ask of the same token takes the place of the one waiting, and the GM can take it back', () => {
    const w = world();
    w.host.requestSpell('s1', 'wizard', fireball);
    w.host.requestSpell('s1', 'wizard', { ...fireball, name: 'Ice storm', shape: 'cylinder', length: 140 });
    expect(w.asks('p1').map((ask) => ask.ask.name)).toEqual(['Ice storm']);
    w.host.cancelSpellRequest('s1', 'wizard');
    expect(w.asks('p1')).toEqual([]);
    expect(w.host.requestOf('s1', 'wizard')).toBeNull();
  });

  it("a cast for it is taken as asked: shape, start and sizes the GM's, its place the player's; the others' ask goes", () => {
    const w = world();
    w.host.requestSpell('s1', 'wizard', fireball);
    w.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' });
    const spells = w.host.spellsFor('s1');
    expect(spells).toHaveLength(1);
    expect(spells[0]!.spell).toEqual({ ...aimed, shape: 'sphere', from: 'point', size: 280, length: 0, caster: 'wizard' });
    expect(w.notify).toHaveBeenCalledWith('Ana cast Fireball.');
    expect(w.asks('p2')).toEqual([]);
    // Answered once: a second cast for it is not taken.
    w.send(BEN, { v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' });
    expect(w.host.spellsFor('s1')).toHaveLength(1);
  });

  it("only the token's players answer it; turning it down tells the GM", () => {
    const w = world();
    w.host.requestSpell('s1', 'wizard', fireball);
    w.send(CARA, { v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' });
    w.send(CARA, { v: 1, type: 'map-spell', sceneId: 's1', decline: 'a1' });
    expect(w.host.spellsFor('s1')).toEqual([]);
    expect(w.host.requestOf('s1', 'wizard')).not.toBeNull();
    w.send(BEN, { v: 1, type: 'map-spell', sceneId: 's1', decline: 'a1' });
    expect(w.notify).toHaveBeenCalledWith('Ben turned down Fireball.');
    expect(w.host.requestOf('s1', 'wizard')).toBeNull();
    expect(w.asks('p1')).toEqual([]);
  });

  it("waits for a player admitted later, and is not held back by the player's own spell limit", () => {
    const w = world();
    w.control.set('wizard', new Set(['p3']));
    w.host.requestSpell('s1', 'wizard', fireball);
    w.admit(CARA);
    expect(w.asks('p3')).toHaveLength(1);
    for (let i = 0; i < 10; i++) w.send(CARA, { v: 1, type: 'map-spell', sceneId: 's1', add: { ...aimed, shape: 'sphere', size: 70, length: 0 } });
    w.send(CARA, { v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' });
    expect(w.host.spellsFor('s1').some((spell) => spell.spell.caster === 'wizard')).toBe(true);
  });

  it('a wall asked is no longer than its longest run', () => {
    const wall: SpellAsk = { shape: 'wall', from: 'point', size: 70, length: 280, longest: 140 };
    const made = askedSpell({ ...aimed, shape: 'wall', from: 'point', at: { x: 0, y: 0, h: 0 }, to: { x: 700, y: 0 }, size: 5, length: 5 }, wall);
    expect(made.to).toEqual({ x: 140, y: 0 });
    expect(made.size).toBe(70);
    expect(made.length).toBe(280);
    const sphere = askedSpell({ ...aimed, shape: 'wall', to: { x: 1, y: 1 } }, fireball);
    expect(sphere.to).toBeUndefined();
  });
});

describe('spell ask messages', () => {
  it('an ask, a cast for one and a turn down decode; a bad ask does not', () => {
    expect(isSpellAsk(fireball)).toBe(true);
    expect(isSpellAsk({ ...fireball, shape: 'blob' })).toBe(false);
    expect(isSpellAsk({ ...fireball, size: -1 })).toBe(false);
    expect(isSpellAsk({ ...fireball, extra: 1 })).toBe(false);
    expect(isSpellAsk({ shape: 'wall', from: 'point', size: 70, length: 0 })).toBe(false);
    const round = (message: ControlMessage) => (decodeControl(encodeControl(message)).kind === 'message' ? true : null);
    expect(round({ v: 1, type: 'map-spells', sceneId: 's1', spells: [], asks: [{ id: 'a1', tokenId: 'wizard', ask: fireball }] })).not.toBeNull();
    expect(round({ v: 1, type: 'map-spells', sceneId: 's1', spells: [], asks: [{ id: 'a1', tokenId: 'wizard', ask: { ...fireball, size: 0 } }] })).toBeNull();
    expect(round({ v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' })).not.toBeNull();
    expect(round({ v: 1, type: 'map-spell', sceneId: 's1', decline: 'a1' })).not.toBeNull();
    expect(round({ v: 1, type: 'map-spell', sceneId: 's1', remove: 's1', request: 'a1' })).toBeNull();
    expect(round({ v: 1, type: 'map-spell', sceneId: 's1', decline: 'a1', clear: true })).toBeNull();
  });
});
