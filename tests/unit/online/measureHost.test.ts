import { describe, expect, it } from 'vitest';
import { measureKind, measureToSpell, MEASURE_LIMITS, readExtra, type MeasureRecord } from '../../../packages/atlas-host/src/spellMeasure';
import type { Spell, SpellAbout } from '../../../src/app/online/tools/spells';
import { ANA, BEN, CARA, MAP, measureWorld } from './measureWorld';

const sphere: Spell = { shape: 'sphere', from: 'point', at: { x: 400, y: 300, h: 10 }, yaw: 0.5, pitch: 0, roll: 0, size: 140, length: 0, angle: 0.93, effect: 'fire' };
const lasting: SpellAbout = { line: '2nd-level', properties: [['Duration', 'Concentration, up to 1 minute']], text: 'It lasts.' };
const instant: SpellAbout = { line: '3rd-level', properties: [['Duration', ' Instantaneous ']], text: 'Boom.' };
const cast = (extra: object = {}) => ({ v: 1 as const, type: 'map-spell' as const, sceneId: 's1', add: sphere, ...extra });
const template = (shape: 'cone' | 'circle' = 'cone') => ({ v: 1 as const, type: 'map-template' as const, sceneId: 's1', add: { shape, start: { x: 10, y: 20 }, end: { x: 150, y: 20 } } });
const record = (value: unknown): MeasureRecord => value as MeasureRecord;

describe("players' spells are kept in Atlas's measures", () => {
  it("a cast is one measure in Atlas's store, in one undo step, made by the player; nothing is kept beside it", () => {
    const w = measureWorld();
    w.send(ANA, cast({ name: 'Web', about: lasting, rules: { difficult: true } }));
    expect(w.transactions()).toBe(1);
    expect(w.list()).toHaveLength(1);
    const kept = record(w.list()[0]);
    expect(kept).toMatchObject({ shape: 'circle', by: 'Ana', effect: 'fire' });
    expect(readExtra(kept)).toMatchObject({ kind: 'spell', owner: 'p1', name: 'Web', rules: { difficult: true } });
    expect(measureToSpell(kept)!.spell).toMatchObject({ shape: 'sphere', from: 'point', size: 140 });
    // No list goes out: players get the measure in the scene.
    expect(w.sent.map(([, m]) => m.type as string).filter((type) => type === 'map-spells' || type === 'map-templates')).toEqual([]);
    expect(Object.keys(w.host).sort()).not.toContain('spellsByScene');
  });

  it("takes nothing of who made it from the message: the owner and the name are the GM's", () => {
    const w = measureWorld();
    w.send(BEN, cast({ add: { ...sphere, caster: 'someone' }, name: 'Web', about: lasting, owner: 'p1', by: 'Ana' } as never));
    const kept = record(w.list()[0]);
    expect([kept.by, readExtra(kept)?.owner]).toEqual(['Ben', 'p2']);
  });

  it('an instantaneous spell is flashed to the scene and the board, and kept nowhere', () => {
    const w = measureWorld();
    w.send(ANA, cast({ name: 'Fireball', about: instant, rules: { push: 10 } }));
    expect(w.list()).toEqual([]);
    expect(w.transactions()).toBe(0);
    const flash = w.lastOf('p2', 'spell-flash')!;
    expect(flash.cast).toMatchObject({ owner: 'p1', name: 'Fireball', rules: { push: 10 }, spell: { shape: 'sphere' } });
    expect(w.flashes).toEqual([[MAP, flash.cast]]);
  });

  it('an instantaneous spell that summons is kept: its going is what offers to take its summons off', () => {
    const w = measureWorld();
    w.send(ANA, cast({ name: 'Find Familiar', about: instant, rules: { summon: { name: 'Owl', count: 1 } } }));
    expect(w.list()).toHaveLength(1);
    expect(readExtra(record(w.list()[0]))).toMatchObject({ kind: 'spell', rules: { summon: { name: 'Owl', count: 1 } } });
    expect(w.lastOf('p2', 'spell-flash')).toBeUndefined();
  });

  it("holds a player to ten kept spells and a scene to forty; an answer to the GM's ask is held by the scene only", () => {
    const w = measureWorld();
    for (let i = 0; i < MEASURE_LIMITS.perPlayer + 1; i++) { w.tick(); w.send(ANA, cast()); }
    expect(w.list()).toHaveLength(MEASURE_LIMITS.perPlayer);
    expect(w.lastOf('p1', 'map-refused')).toEqual({ v: 1, type: 'map-refused', what: 'spell', reason: 'limit' });
    w.host.requestSpell('s1', 'wizard', { name: 'Shield', shape: 'sphere', from: 'self', size: 70, length: 0 });
    w.send(ANA, cast({ request: w.asks('p1')[0]!.id }));
    expect(w.list()).toHaveLength(MEASURE_LIMITS.perPlayer + 1);
    for (const player of [BEN, CARA, { ...CARA, playerId: 'p4', name: 'Dee' }]) for (let i = 0; i < MEASURE_LIMITS.perPlayer; i++) { w.tick(); w.send(player, cast()); }
    expect(w.list()).toHaveLength(MEASURE_LIMITS.perScene);
    expect(w.lastOf('p4', 'map-refused')?.reason).toBe('limit');
  });

  it("says so when Atlas's level is full, and when Atlas holds another map; nothing is written then", () => {
    const full = measureWorld({ cap: 1 });
    full.send(ANA, cast());
    full.send(BEN, cast());
    expect(full.list()).toHaveLength(1);
    expect(full.lastOf('p2', 'map-refused')).toEqual({ v: 1, type: 'map-refused', what: 'spell', reason: 'full' });
    const away = measureWorld();
    away.hold('maps/other.atlasmap');
    away.send(ANA, cast());
    away.send(ANA, template());
    expect(away.list()).toEqual([]);
    expect(away.sent.filter(([to, m]) => to === 'p1' && m.type === 'map-refused').map(([, m]) => m)).toEqual([
      { v: 1, type: 'map-refused', what: 'spell', reason: 'not-held' }, { v: 1, type: 'map-refused', what: 'template', reason: 'not-held' },
    ]);
  });

  it('an instantaneous spell taken off again by its board is no write: nothing is refused, though Atlas holds another map', () => {
    const away = measureWorld();
    away.hold('maps/other.atlasmap');
    away.send(ANA, cast({ name: 'Fireball', about: instant }));
    const flash = away.lastOf('p2', 'spell-flash')!;
    away.tick();
    // The player's board takes its own instantaneous spell off a moment after the cast.
    away.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', remove: (flash.cast as { id: string }).id });
    expect(away.sent.filter(([, m]) => m.type === 'map-refused')).toEqual([]);
  });

  it("a player takes off their own spells, never another's", () => {
    const w = measureWorld();
    w.send(ANA, cast());
    w.send(BEN, cast());
    const [anas, bens] = w.list().map((measure) => measure.id as string);
    w.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', remove: bens! });
    expect(w.list()).toHaveLength(2);
    w.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', remove: anas! });
    expect(w.list().map((measure) => measure.id)).toEqual([bens]);
    w.send(BEN, cast());
    w.send(BEN, { v: 1, type: 'map-spell', sceneId: 's1', clear: true });
    expect(w.list()).toEqual([]);
  });

  it('still lets a player take off their own while a cutscene runs', () => {
    let running = false;
    const w = measureWorld({ cutscene: () => running });
    w.send(ANA, template());
    w.send(ANA, cast());
    running = true;
    w.send(ANA, { v: 1, type: 'map-template', sceneId: 's1', clear: true });
    w.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', clear: true });
    expect(w.list()).toEqual([]);
    w.send(ANA, template());
    expect(w.list()).toEqual([]);
  });

  it('adds nothing while a cutscene runs, and nothing for a scene the player does not have', () => {
    let running = true;
    const w = measureWorld({ cutscene: () => running });
    w.send(ANA, cast());
    w.send(ANA, template());
    expect(w.list()).toEqual([]);
    running = false;
    w.send(ANA, cast({ sceneId: 'other' }));
    expect(w.list()).toEqual([]);
  });
});

describe("players' templates are temporary measures", () => {
  it('one per player: a new one takes the place of the last, in one undo step', () => {
    const w = measureWorld();
    w.send(ANA, template('cone'));
    w.send(ANA, template('circle'));
    w.send(BEN, template('cone'));
    expect(w.list().map((measure) => [measure.shape, measure.by, readExtra(record(measure))?.temp])).toEqual([['circle', 'Ana', true], ['cone', 'Ben', true]]);
    expect(w.transactions()).toBe(3);
    expect(w.list().every((measure) => measureKind(record(measure)) === 'template')).toBe(true);
  });

  it("goes when its player leaves, when the session ends, and in a sweep when a session starts; kept spells stay", () => {
    const w = measureWorld();
    w.send(ANA, template());
    w.send(BEN, template());
    w.send(ANA, cast());
    w.setPlayers([ANA, CARA]);
    expect(w.list().map((measure) => [measureKind(record(measure)), measure.by])).toEqual([['template', 'Ana'], ['spell', 'Ana']]);
    w.host.stop();
    expect(w.list().map((measure) => measureKind(record(measure)))).toEqual(['spell']);
    // A template a crashed session left in the map: swept when the next one starts, and when Atlas comes to the map.
    w.measures.stale = { id: 'stale', kind: 'measure', shape: 'cone', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], tabletop: { v: 1, kind: 'template', owner: 'gone', temp: true } };
    w.measures.atlas = { id: 'atlas', kind: 'measure', shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] };
    w.host.start();
    expect(Object.keys(w.measures)).not.toContain('stale');
    expect(Object.keys(w.measures)).toContain('atlas');
    w.measures.stale = { id: 'stale', kind: 'measure', shape: 'cone', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], tabletop: { v: 1, kind: 'template', owner: 'gone', temp: true } };
    w.slotChange('state');
    expect(Object.keys(w.measures)).not.toContain('stale');
  });

  it("the GM's Clear templates takes every template and spell off the map Atlas shows, and leaves Atlas's own areas", () => {
    const w = measureWorld();
    w.measures.atlas = { id: 'atlas', kind: 'measure', shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] };
    expect(w.host.hasAny()).toBe(false);
    w.send(ANA, template());
    w.send(BEN, cast());
    expect(w.host.hasAny()).toBe(true);
    const before = w.transactions();
    w.host.clear();
    expect(Object.keys(w.measures)).toEqual(['atlas']);
    expect(w.transactions()).toBe(before + 1);
  });
});
