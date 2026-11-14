import { describe, expect, it } from 'vitest';
import { spellToMeasure, templateToMeasure, type SpellLike } from '../../../packages/atlas-host/src/spellMeasure';
import { decodeControl } from '../../../src/app/online/protocol';
import { MEASURE_BUDGET_BYTES, projectMeasures } from '../../../src/app/online/scene/projectMeasures';
import { byteLength } from '../../../src/app/online/scene/sceneMessages';
import { SCENE_LIMITS } from '../../../src/app/online/scene/sceneLimits';
import { isPlayerMeasure } from '../../../src/app/online/scene/sceneValidation';
import { diffScenes, applyPatch } from '../../../src/app/online/scene/sceneDiff';
import { playerScene } from './sceneFixtures';

const circle = (over: Record<string, unknown> = {}) => ({ id: 'm', kind: 'measure', shape: 'circle', points: [{ x: 100, y: 100 }, { x: 240, y: 100 }], ...over });
const spell: SpellLike = { shape: 'sphere', from: 'point', at: { x: 700, y: 420, h: 70 }, yaw: 0, pitch: 0, roll: 0, size: 140, length: 0, angle: 1, effect: 'fire' };
const seeAll = { closed: false, seen: () => true };
const decodeRaw = (value: unknown): ReturnType<typeof decodeControl> => decodeControl(JSON.stringify(value));

describe('the measures players are sent', () => {
  it('sends an area with what draws it, and nothing else of it', () => {
    const sent = projectMeasures({
      m1: circle({ id: 'm1', color: '#ff8800', by: 'Anna', effect: 'fire', walls: false, level: 'ground', light: { bright: 20, dim: 40 }, secret: 'SECRET' }),
      m2: { id: 'm2', kind: 'measure', shape: 'line', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], width: 35 },
      m3: { id: 'm3', kind: 'measure', shape: 'ruler', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }] },
    }, seeAll);
    expect(sent).toEqual({
      m1: { shape: 'circle', points: [{ x: 100, y: 100 }, { x: 240, y: 100 }], color: '#ff8800', walls: false, effect: 'fire' },
      m2: { shape: 'line', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], width: 35 },
      m3: { shape: 'ruler', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }] },
    });
    expect(JSON.stringify(sent)).not.toMatch(/SECRET|light|Anna|level/);
  });

  it("keeps from players what Atlas keeps from them: a hidden one, one that started on a token they did not or do not see, an aura of an unseen token", () => {
    const seen = (id: string): boolean => id === 'hero';
    const sent = projectMeasures({
      hidden: circle({ id: 'hidden', hidden: true }),
      unseenStart: circle({ id: 'unseenStart', origin: { tokenIds: ['hero'], unseenAtStart: true } }),
      unseenNow: circle({ id: 'unseenNow', origin: { tokenIds: ['hero', 'ghost'], unseenAtStart: false } }),
      badOrigin: circle({ id: 'badOrigin', origin: 'x' }),
      fromHero: circle({ id: 'fromHero', origin: { tokenIds: ['hero'], unseenAtStart: false } }),
      ghostAura: circle({ id: 'ghostAura', follows: 'ghost', aura: 10 }),
      heroAura: circle({ id: 'heroAura', follows: 'hero', aura: 10 }),
    }, { closed: false, seen });
    expect(Object.keys(sent)).toEqual(['fromHero', 'heroAura']);
    expect(sent.fromHero).not.toHaveProperty('origin');
    expect(sent.heroAura?.aura).toEqual({ token: 'hero', reach: 10 });
    expect(projectMeasures({ m: circle() }, { closed: true, seen: () => true })).toEqual({});
  });

  it('drops what is no measure, and holds numbers to their ranges', () => {
    const sent = projectMeasures({
      a: 'x', b: null, c: circle({ shape: 'blob' }), d: circle({ points: [{ x: 1, y: 2 }] }), e: circle({ points: [{ x: Number.NaN, y: 0 }, { x: 1, y: 1 }] }),
      __proto__x: circle(), ok: circle({ id: 'ok', color: 'red', width: -4, effect: 'glitter', walls: true }),
    } as never, seeAll);
    expect(Object.keys(sent)).toEqual(['__proto__x', 'ok']);
    expect(sent.ok).toEqual({ shape: 'circle', points: [{ x: 100, y: 100 }, { x: 240, y: 100 }] });
    expect(projectMeasures('measures', seeAll)).toEqual({});
    expect(projectMeasures(undefined, seeAll)).toEqual({});
  });

  it("sends a spell's 3D shape, damage, name, checked rules and cut words, its owner, and its caster only where players see it", () => {
    const about = { line: '3rd-level evocation', properties: [['Duration', 'Concentration']] as Array<[string, string]>, text: 'y'.repeat(3000) };
    const kept = { id: 's1', kind: 'measure', ...spellToMeasure({ ...spell, caster: 'ghost' }, { owner: 'p1', by: 'Anna', color: '#ff8800', name: 'Wall of Fire', about, rules: { difficult: true } }) };
    const record = { ...kept, tabletop: { ...(kept.tabletop as object), junk: 'SECRET' } };
    const sent = projectMeasures({ s1: record }, { closed: false, seen: (id) => id !== 'ghost' }).s1!;
    expect(sent.owner).toBe('p1');
    expect(sent.tabletop).toMatchObject({ v: 1, kind: 'spell', shape: 'sphere', effect: 'fire', name: 'Wall of Fire', owner: 'p1', rules: { difficult: true } });
    expect(sent.tabletop).not.toHaveProperty('caster');
    expect(sent.tabletop).not.toHaveProperty('junk');
    // Rules that are not Connect's own (a key it does not know) are not sent at all.
    const odd = { ...kept, tabletop: { ...(kept.tabletop as object), rules: { difficult: true, bogus: 1 } } };
    expect(projectMeasures({ s1: odd }, seeAll).s1!.tabletop).not.toHaveProperty('rules');
    expect((sent.tabletop as { about: { text: string } }).about.text.length).toBeLessThanOrEqual(600);
    const template = projectMeasures({ t: { id: 't', kind: 'measure', ...templateToMeasure({ shape: 'cone', start: { x: 0, y: 0 }, end: { x: 70, y: 0 } }, { owner: 'p2', by: 'Ben', color: '#22c55e' }) } }, seeAll).t!;
    expect(template).toMatchObject({ shape: 'cone', color: '#22c55e', owner: 'p2', tabletop: { kind: 'template', temp: true } });
  });

  it('stays under its share of a message: the words go first, then the newest measures', () => {
    const about = { line: 'x', properties: [], text: 'y'.repeat(590) };
    const many = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`s${i}`, { id: `s${i}`, kind: 'measure', ...spellToMeasure(spell, { name: `Spell ${i}`, about, rules: { light: { bright: 20, dim: 20 } } }) }]));
    const sent = projectMeasures(many, seeAll);
    expect(byteLength(sent)).toBeLessThanOrEqual(MEASURE_BUDGET_BYTES);
    expect(Object.keys(sent).length).toBeGreaterThan(100);
    expect(JSON.stringify(sent)).not.toContain('yyyy');
    expect(Object.keys(sent)[0]).toBe('s0');
  });
});

describe('measures on the wire', () => {
  const measure = { shape: 'circle', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
  const patch = (measures: object): ReturnType<typeof decodeControl> => decodeRaw({ v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: { measures }, remove: {} });

  it('is a record of the scene: upserted and removed by patches', () => {
    const before = playerScene();
    const after = { ...before, measures: { m1: measure } } as ReturnType<typeof playerScene>;
    const added = diffScenes(before, after)!;
    expect(added.upsert.measures).toEqual({ m1: measure });
    expect(applyPatch(before, added).measures).toEqual({ m1: measure });
    const removed = diffScenes(after, before)!;
    expect(removed.remove.measures).toEqual(['m1']);
    expect(applyPatch(after, removed).measures).toEqual({});
    expect(decodeRaw({ v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: {}, remove: { measures: ['m1'] } }).kind).toBe('message');
  });

  it('checks each measure: its shape, its points, its numbers, its extra field', () => {
    const extra = spellToMeasure(spell, { owner: 'p1', name: 'Fireball' }).tabletop;
    for (const ok of [measure, { ...measure, width: 35, color: '#ff8800', walls: false, effect: 'frost', owner: 'p1' }, { ...measure, aura: { token: 't1', reach: 10 } }, { ...measure, tabletop: extra },
      { shape: 'ruler', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] }]) {
      expect(patch({ m: ok }).kind, JSON.stringify(ok)).toBe('message');
    }
    const bad = [
      { ...measure, shape: 'blob' }, { ...measure, points: [{ x: 1, y: 2 }] }, { ...measure, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] },
      { ...measure, width: 0 }, { ...measure, color: 'red' }, { ...measure, walls: true }, { ...measure, effect: 'glitter' }, { ...measure, owner: 5 },
      { ...measure, aura: { token: 't1', reach: 0 } }, { ...measure, tabletop: 5 }, { ...measure, tabletop: { v: 2, kind: 'spell' } },
      { ...measure, tabletop: { ...(extra as object), rules: { wall: 'yes' } } }, { ...measure, tabletop: { ...(extra as object), about: { text: 5 } } },
    ];
    for (const each of bad) expect(patch({ m: each }).kind, JSON.stringify(each)).toBe('invalid');
  });
});

describe('what is sent passes the scene\'s own check', () => {
  it("an owner longer than a player's id is cut, so one hand-edited measure cannot spoil the players' scene", () => {
    const long = 'p'.repeat(200);
    const kept = { ...JSON.parse(JSON.stringify(spellToMeasure({ shape: 'sphere', from: 'point', at: { x: 0, y: 0, h: 0 }, yaw: 0, pitch: 0, roll: 0, size: 70, length: 0, angle: 1 }, { owner: long }))), id: 'm1' };
    const sent = projectMeasures({ m1: kept }, seeAll);
    expect(sent.m1!.owner).toBe(long.slice(0, SCENE_LIMITS.idLength));
    expect(isPlayerMeasure(sent.m1)).toBe(true);
  });
});
