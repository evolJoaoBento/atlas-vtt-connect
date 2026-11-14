import { describe, expect, it } from 'vitest';
import { measureToSpell, readExtra, type MeasureRecord } from '../../../packages/atlas-host/src/spellMeasure';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { projectMeasures, MEASURE_BUDGET_BYTES } from '../../../src/app/online/scene/projectMeasures';
import { byteLength } from '../../../src/app/online/scene/sceneMessages';
import { askedSpell, cleanAsk, isMapSpells, isSpellAsk, isSpellRules, joinAsks, type Spell, type SpellAsk, type SpellRules } from '../../../src/app/online/tools/spells';
import { ANA, BEN, CARA, measureWorld } from './measureWorld';

const fireball: SpellAsk = { name: 'Fireball', shape: 'sphere', from: 'point', size: 280, length: 0 };
const aimed: Spell = { shape: 'cube', from: 'self', at: { x: 400, y: 300, h: 10 }, yaw: 0.5, pitch: 0.1, roll: 0, size: 9999, length: 50, angle: 0.93, caster: 'other' };
const world = measureWorld;
/** The spells Atlas's store holds, as the board reads them back. */
const spellsOf = (w: ReturnType<typeof world>) => w.list().map((measure) => ({ ...measureToSpell(measure as unknown as MeasureRecord)!, extra: readExtra(measure as unknown as MeasureRecord)! }));

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
    const spells = spellsOf(w);
    expect(spells).toHaveLength(1);
    expect(spells[0]!.spell).toMatchObject({ shape: 'sphere', from: 'point', length: 0, caster: 'wizard', pitch: aimed.pitch, roll: aimed.roll });
    expect(spells[0]!.spell.size).toBeCloseTo(280, 6);
    expect(spells[0]!.spell.at.x).toBeCloseTo(aimed.at.x, 6);
    expect(spells[0]!.extra.name).toBe('Fireball');
    expect(w.notify).toHaveBeenCalledWith('Ana cast Fireball.');
    expect(w.asks('p2')).toEqual([]);
    // Answered once: a second cast for it is not taken.
    w.send(BEN, { v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' });
    expect(w.list()).toHaveLength(1);
  });

  it("only the token's players answer it; turning it down tells the GM", () => {
    const w = world();
    w.host.requestSpell('s1', 'wizard', fireball);
    w.send(CARA, { v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' });
    w.send(CARA, { v: 1, type: 'map-spell', sceneId: 's1', decline: 'a1' });
    expect(w.list()).toEqual([]);
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
    for (let i = 0; i < 10; i++) { w.tick(); w.send(CARA, { v: 1, type: 'map-spell', sceneId: 's1', add: { ...aimed, shape: 'sphere', size: 70, length: 0 } }); }
    w.send(CARA, { v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' });
    expect(spellsOf(w).some(({ spell }) => spell.caster === 'wizard')).toBe(true);
  });

  it("an ask whose words say it is instantaneous is flashed when cast, and the ask is answered", () => {
    const w = world();
    const about = { line: 'Level 3 Evocation', properties: [['Duration', 'Instantaneous']] as Array<[string, string]>, text: 'A bright streak.' };
    w.host.requestSpell('s1', 'wizard', { ...fireball, about });
    w.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' });
    expect(w.list()).toEqual([]);
    expect(w.lastOf('p3', 'spell-flash')?.cast).toMatchObject({ owner: 'p1', name: 'Fireball', spell: { shape: 'sphere', caster: 'wizard' } });
    expect(w.notify).toHaveBeenCalledWith('Ana cast Fireball.');
    expect(w.host.requestOf('s1', 'wizard')).toBeNull();
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
  const round = (message: ControlMessage) => (decodeControl(encodeControl(message)).kind === 'message' ? true : null);

  it('an ask, a cast for one and a turn down decode; a bad ask does not', () => {
    expect(isSpellAsk(fireball)).toBe(true);
    expect(isSpellAsk({ ...fireball, shape: 'blob' })).toBe(false);
    expect(isSpellAsk({ ...fireball, size: -1 })).toBe(false);
    expect(isSpellAsk({ ...fireball, extra: 1 })).toBe(false);
    expect(isSpellAsk({ shape: 'wall', from: 'point', size: 70, length: 0 })).toBe(false);
    expect(round({ v: 1, type: 'spell-asks', sceneId: 's1', asks: [{ id: 'a1', tokenId: 'wizard', ask: fireball }] })).not.toBeNull();
    expect(round({ v: 1, type: 'spell-asks', sceneId: 's1', asks: [{ id: 'a1', tokenId: 'wizard', ask: { ...fireball, size: 0 } }] })).toBeNull();
    expect(round({ v: 1, type: 'map-spell', sceneId: 's1', add: aimed, request: 'a1' })).not.toBeNull();
    expect(round({ v: 1, type: 'map-spell', sceneId: 's1', decline: 'a1' })).not.toBeNull();
    expect(round({ v: 1, type: 'map-spell', sceneId: 's1', remove: 's1', request: 'a1' })).toBeNull();
    expect(round({ v: 1, type: 'map-spell', sceneId: 's1', decline: 'a1', clear: true })).toBeNull();
    // A spell is taken off by the id Atlas gave its measure.
    expect(round({ v: 1, type: 'map-spell', sceneId: 's1', remove: 'measure_1794613464743_i9frdxssf' })).not.toBeNull();
    expect(round({ v: 1, type: 'map-template', sceneId: 's1', remove: 'measure_1794613464743_i9frdxssf' })).not.toBeNull();
  });

  it('a flash and a refusal decode; a flash of no spell, or a refusal for no reason, does not', () => {
    const cast = { id: 'f1', owner: 'p1', color: '#ff0059', spell: { ...aimed, size: 10 }, name: 'Fireball' };
    expect(round({ v: 1, type: 'spell-flash', sceneId: 's1', cast })).not.toBeNull();
    expect(isMapSpells([cast])).toBe(true);
    expect(round({ v: 1, type: 'spell-flash', sceneId: 's1', cast: { ...cast, spell: { ...aimed, shape: 'blob' } } } as never)).toBeNull();
    for (const reason of ['not-held', 'limit', 'full'] as const) expect(round({ v: 1, type: 'map-refused', what: 'spell', reason })).not.toBeNull();
    expect(round({ v: 1, type: 'map-refused', what: 'spell', reason: 'whim' } as never)).toBeNull();
    expect(round({ v: 1, type: 'map-refused', what: 'door', reason: 'full' } as never)).toBeNull();
  });

  it("carries the spell's damage and its words to the player; the cast takes the ask's damage", () => {
    const about = { line: 'Level 3 Evocation', properties: [['Range', '150 feet'], ['Damage', '8d6 fire']] as Array<[string, string]>, text: 'A bright streak flashes.' };
    const full: SpellAsk = { ...fireball, effect: 'fire', about };
    expect(isSpellAsk(full)).toBe(true);
    expect(cleanAsk(full)).toEqual(full);
    expect(isSpellAsk({ ...fireball, effect: 'glitter' })).toBe(false);
    expect(isSpellAsk({ ...fireball, about: { ...about, text: 'x'.repeat(4001) } })).toBe(false);
    expect(isSpellAsk({ ...fireball, about: { ...about, properties: [['Range', 3]] } })).toBe(false);
    expect(isSpellAsk({ ...fireball, about: { ...about, extra: 1 } })).toBe(false);
    expect(askedSpell({ ...aimed, effect: 'cold' }, full).effect).toBe('fire');
    expect(askedSpell({ ...aimed, effect: 'cold' }, fireball).effect).toBe('cold');
    expect(round({ v: 1, type: 'spell-asks', sceneId: 's1', asks: [{ id: 'a1', tokenId: 'wizard', ask: full }] })).not.toBeNull();
  });

  it("sends a spell's damage and words beside the asks; the player joins them again", () => {
    const w = world();
    const about = { line: 'Level 3 Evocation', properties: [['Range', '150 feet']] as Array<[string, string]>, text: 'A bright streak.' };
    w.host.requestSpell('s1', 'wizard', { ...fireball, effect: 'fire', about });
    const message = w.lastOf('p1', 'spell-asks')!;
    expect(message.asks).toEqual([{ id: 'a1', tokenId: 'wizard', ask: fireball }]);
    expect(message.askWords).toEqual([{ id: 'a1', effect: 'fire', about }]);
    expect(joinAsks(message.asks, message.askWords)).toEqual([{ id: 'a1', tokenId: 'wizard', ask: { ...fireball, effect: 'fire', about } }]);
    expect(decodeControl(encodeControl(message)).kind).toBe('message');
    expect(decodeControl(encodeControl({ ...message, askWords: [{ id: 'a1', effect: 'glitter' }] } as never)).kind).not.toBe('message');
    // A plain ask sends no words.
    const plain = world();
    plain.host.requestSpell('s1', 'wizard', fireball);
    expect(plain.lastOf('p1', 'spell-asks')!.askWords).toBeUndefined();
  });

  it("a spell's rules (wall, light, push…) travel beside it: on its measure, beside an ask, and with a player's cast", () => {
    const rules: SpellRules = { name: 'Thunderwave', push: 10, wall: { blocks: 'both', look: 'stone' }, light: { bright: 20, dim: 20 }, summon: { name: 'Wolf', count: 2 }, portal: 'Gate', difficult: true };
    expect(isSpellRules(rules)).toBe(true);
    expect(isSpellRules({ push: 'far' })).toBe(false);
    expect(isSpellRules({ wall: { blocks: 'both', look: 'gold' } })).toBe(false);
    expect(isSpellRules({ summon: { name: 'Wolf', count: 99 } })).toBe(false);
    expect(isSpellRules({ teleport: 30, extra: 1 })).toBe(false);
    // An ask's rules go beside it, and come back joined.
    const w = world();
    w.host.requestSpell('s1', 'wizard', { ...fireball, rules });
    const message = w.lastOf('p1', 'spell-asks')!;
    expect(message.asks).toEqual([{ id: 'a1', tokenId: 'wizard', ask: fireball }]);
    expect(message.askWords).toBeUndefined();
    expect(message.askRules).toEqual([{ id: 'a1', rules }]);
    expect(joinAsks(message.asks, message.askWords, message.askRules)[0]!.ask.rules).toEqual(rules);
    // The cast for it takes the ask's rules and name, whatever the player sent.
    w.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', add: { ...aimed, size: 10 }, request: 'a1', rules: { push: 99 }, name: 'Mine' });
    expect(spellsOf(w)[0]!.extra).toMatchObject({ rules, name: 'Fireball' });
    // A cast of the player's own takes theirs, with its name and words.
    w.send(BEN, { v: 1, type: 'map-spell', sceneId: 's1', add: { ...aimed, size: 10 }, rules: { teleport: 30 }, name: 'Misty Step', about: { line: 'Level 2 Conjuration', properties: [], text: 'You teleport.' } });
    expect(spellsOf(w).at(-1)!.extra).toMatchObject({ rules: { teleport: 30 }, name: 'Misty Step', about: { text: 'You teleport.' } });
    expect(decodeControl(encodeControl({ v: 1, type: 'map-spell', sceneId: 's1', add: aimed, name: 'x'.repeat(61) } as never)).kind).not.toBe('message');
    // Bad rules are turned down.
    expect(decodeControl(encodeControl({ v: 1, type: 'map-spell', sceneId: 's1', add: aimed, rules: { push: 'far' } } as never)).kind).not.toBe('message');
    expect(decodeControl(encodeControl({ v: 1, type: 'map-spell', sceneId: 's1', remove: 's1', rules: { push: 1 } } as never)).kind).not.toBe('message');
  });

  it("a scene full of spells, each with the longest words and rules, still reaches players within the measures' share of a message", () => {
    const w = world();
    const about = { line: 'L'.repeat(120), properties: Array.from({ length: 10 }, (_, k) => [`P${k}`.padEnd(30, 'x'), 'é'.repeat(200)] as [string, string]), text: '火'.repeat(4000) };
    const rules: SpellRules = { name: 'n'.repeat(120), wall: { blocks: 'both', look: 'stone' }, obscure: true, dark: true, light: { bright: 9999, dim: 9999, color: '#ffffff' }, difficult: true, push: -9999, teleport: 9999, portal: 'p'.repeat(120), summon: { name: 's'.repeat(120), count: 20, statblock: 'b'.repeat(120) } };
    for (const player of [ANA, BEN, CARA, { ...CARA, playerId: 'p4', name: 'Dee' }]) {
      for (let k = 0; k < 10; k++) { w.tick(); w.send(player, { v: 1, type: 'map-spell', sceneId: 's1', add: { ...aimed, size: 10, caster: 'c'.repeat(200) }, rules, name: 'N'.repeat(60), about }); }
    }
    expect(w.list()).toHaveLength(40);
    // Kept with its words cut as a cast's always were.
    expect((spellsOf(w)[0]!.extra.about as { text: string }).text.length).toBe(600);
    const sent = projectMeasures(w.measures, { closed: false, seen: () => true });
    expect(Object.keys(sent)).toHaveLength(40);
    expect(byteLength(sent)).toBeLessThanOrEqual(MEASURE_BUDGET_BYTES);
  });
});
