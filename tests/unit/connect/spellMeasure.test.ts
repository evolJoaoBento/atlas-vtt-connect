import { describe, expect, it } from 'vitest';
import {
  atlasEffectOf, damageOfEffect, measureKind, measureToSpell, MEASURE_LIMITS, SPELL_CHAIN, spellToMeasure, templateToMeasure,
  type MeasureRecord, type SpellLike,
} from '../../../packages/atlas-host/src/index';

const spell = (over: Partial<SpellLike>): SpellLike => ({
  shape: 'sphere', from: 'point', at: { x: 700, y: 420, h: 70 }, yaw: 0.6, pitch: 0, roll: 0.2, size: 140, length: 0, angle: Math.PI / 3, ...over,
});

const close = (a: number, b: number): void => expect(Math.abs(a - b)).toBeLessThan(1e-6);
function same(a: SpellLike, b: SpellLike): void {
  expect([b.shape, b.from, b.caster, b.effect]).toEqual([a.shape, a.from, a.caster, a.effect]);
  close(b.at.x, a.at.x); close(b.at.y, a.at.y); close(b.at.h, a.at.h);
  // A turn reads the same a whole turn on.
  close(Math.sin(b.yaw), Math.sin(a.yaw)); close(Math.cos(b.yaw), Math.cos(a.yaw));
  close(b.pitch, a.pitch); close(b.roll, a.roll); close(b.size, a.size); close(b.length, a.length); close(b.angle, a.angle);
  if (a.to) { close(b.to!.x, a.to.x); close(b.to!.y, a.to.y); } else expect(b.to).toBeUndefined();
}

const SHAPES: Array<Partial<SpellLike>> = [
  { shape: 'sphere' }, { shape: 'cube' }, { shape: 'cone' }, { shape: 'cylinder', size: 35, length: 420 },
  { shape: 'wall', from: 'point', to: { x: 980, y: 560 }, size: 20, length: 210 },
];

describe('a spell as an Atlas measure, and back', () => {
  it('reads back the spell it was made from, for every shape, cast from the caster or at a point, level or pitched', () => {
    for (const shape of SHAPES) {
      for (const from of shape.shape === 'wall' ? ['point' as const] : ['self' as const, 'point' as const]) {
        for (const pitch of [0, 0.4, 1.5, -0.7]) {
          const made = spell({ ...shape, from, pitch, caster: 'tok-1', effect: 'fire' });
          const read = measureToSpell(spellToMeasure(made, { owner: 'p1', by: 'Anna', color: '#ff8800', name: 'Fireball' }));
          expect(read, `${shape.shape} ${from} ${pitch}`).not.toBeNull();
          same(made, read!.spell);
          expect(read!.meta).toMatchObject({ owner: 'p1', by: 'Anna', color: '#ff8800', name: 'Fireball' });
        }
      }
    }
  });

  it("lies flat as Atlas reads it: a circle, a square from the middle of its near side, a cone from its tip, a line as wide as a wall is thick", () => {
    const sphere = spellToMeasure(spell({ shape: 'sphere' }));
    expect(sphere.shape).toBe('circle');
    expect(sphere.points[0]).toEqual({ x: 700, y: 420 });
    close(Math.hypot(sphere.points[1]!.x - 700, sphere.points[1]!.y - 420), 140);
    const cube = spellToMeasure(spell({ shape: 'cube', yaw: 0 }));
    expect(cube.shape).toBe('square');
    // Looking along -y (yaw 0): the near side's middle is half a side behind the cube's centre.
    close(cube.points[0]!.x, 700); close(cube.points[0]!.y, 490); close(cube.points[1]!.y, 350);
    const cone = spellToMeasure(spell({ shape: 'cone', from: 'self', yaw: 0 }));
    expect(cone.shape).toBe('cone');
    expect(cone.points[0]).toEqual({ x: 700, y: 420 });
    close(cone.points[1]!.y, 280);
    const wall = spellToMeasure(spell({ shape: 'wall', to: { x: 980, y: 420 }, size: 20, length: 210 }));
    expect([wall.shape, wall.width, wall.points]).toEqual(['line', 20, [{ x: 700, y: 420 }, { x: 980, y: 420 }]]);
  });

  it('a beam along the floor is a line twice its radius wide; a standing one is a circle', () => {
    const beam = spellToMeasure(spell({ shape: 'cylinder', from: 'self', size: 35, length: 420, yaw: 0, pitch: 0 }));
    expect([beam.shape, beam.width]).toEqual(['line', 70]);
    close(beam.points[1]!.y, 0);
    const column = spellToMeasure(spell({ shape: 'cylinder', from: 'point', size: 140, length: 280, pitch: Math.PI / 2 }));
    expect(column.shape).toBe('circle');
    close(Math.hypot(column.points[1]!.x - column.points[0]!.x, column.points[1]!.y - column.points[0]!.y), 140);
  });

  it('follows its measure: moved, turned or resized in Atlas, the 3D shape goes with it', () => {
    const made = spell({ shape: 'cube', yaw: 0, size: 140 });
    const measure = spellToMeasure(made);
    const moved = { ...measure, points: measure.points.map((p) => ({ x: p.x + 100, y: p.y + 50 })) };
    const afterMove = measureToSpell(moved)!.spell;
    close(afterMove.at.x, 800); close(afterMove.at.y, 470); close(afterMove.size, 140);
    // Twice as long from the same origin: twice the side, its centre half the new side along.
    const [p0, p1] = measure.points as [{ x: number; y: number }, { x: number; y: number }];
    const grown = measureToSpell({ ...measure, points: [p0, { x: p0.x + (p1.x - p0.x) * 2, y: p0.y + (p1.y - p0.y) * 2 }] })!.spell;
    close(grown.size, 280); close(grown.at.y, p0.y - 140);
    // Turned a quarter turn about its origin: it now runs along +x.
    const turned = measureToSpell({ ...measure, points: [p0, { x: p0.x + 140, y: p0.y }] })!.spell;
    close(turned.at.x, p0.x + 70); close(turned.at.y, p0.y);
    close(-Math.sin(turned.yaw), 1); close(-Math.cos(turned.yaw), 0);
    // A wall's thickness is the line's width as Atlas has it.
    const wall = spellToMeasure(spell({ shape: 'wall', to: { x: 980, y: 420 }, size: 20, length: 210 }));
    close(measureToSpell({ ...wall, width: 40 })!.spell.size, 40);
  });

  it('reads no spell from a measure that carries none, or junk', () => {
    const good = spellToMeasure(spell({}));
    const extra = good.tabletop as Record<string, unknown>;
    const bad: MeasureRecord[] = [
      { shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] },
      { ...good, tabletop: 5 },
      { ...good, tabletop: null },
      { ...good, tabletop: { ...extra, v: 2 } },
      { ...good, tabletop: { ...extra, shape: 'pyramid' } },
      { ...good, tabletop: { ...extra, rel: { ...(extra.rel as object), size: Number.NaN } } },
      { ...good, tabletop: { ...extra, rel: 'x' } },
      { ...good, tabletop: { ...extra, h: 'high' } },
      { ...good, points: [{ x: 5, y: 5 }, { x: 5, y: 5 }] },
      { ...good, points: [{ x: 5, y: 5 }] },
      { ...good, points: [{ x: Number.NaN, y: 5 }, { x: 9, y: 5 }] },
      { ...good, tabletop: { ...extra, rel: { ...(extra.rel as object), size: 1e9 } } },
    ];
    for (const measure of bad) expect(measureToSpell(measure), JSON.stringify(measure.tabletop)).toBeNull();
    expect(measureKind(bad[0]!)).toBe('area');
    expect(measureKind(bad[1]!)).toBe('area');
    expect(measureKind(good)).toBe('spell');
  });

  it("carries the spell's words, rules and owner beside it, the words cut to the limit, and Atlas's look for its damage", () => {
    const about = { line: 'x', properties: [], text: 'y'.repeat(MEASURE_LIMITS.about + 500) };
    const measure = spellToMeasure(spell({ effect: 'cold' }), { owner: 'p1', by: 'Anna', color: '#3366ff', name: 'Cone of Cold', about, rules: { difficult: true }, hidden: true });
    expect([measure.color, measure.by, measure.hidden, measure.effect]).toEqual(['#3366ff', 'Anna', true, 'frost']);
    const read = measureToSpell(measure)!;
    expect(read.meta.rules).toEqual({ difficult: true });
    expect((read.meta.about as { text: string }).text).toHaveLength(MEASURE_LIMITS.about);
    expect(spellToMeasure(spell({ effect: 'poison' })).effect).toBeUndefined();
    expect([atlasEffectOf('radiant'), atlasEffectOf('psychic'), damageOfEffect('frost'), damageOfEffect('shadow'), damageOfEffect('mist'), damageOfEffect('nope')])
      .toEqual(['radiance', undefined, 'cold', 'necrotic', undefined, undefined]);
    expect(SPELL_CHAIN('m1')).toBe('spell:m1');
  });

  it("a player's template is a temporary measure of Atlas's own shape", () => {
    const measure = templateToMeasure({ shape: 'cone', start: { x: 10, y: 20 }, end: { x: 150, y: 20 } }, { owner: 'p2', by: 'Ben', color: '#22c55e' });
    expect(measure).toMatchObject({ shape: 'cone', points: [{ x: 10, y: 20 }, { x: 150, y: 20 }], color: '#22c55e', by: 'Ben', tabletop: { v: 1, kind: 'template', owner: 'p2', temp: true } });
    expect(measureKind(measure)).toBe('template');
    expect(measureToSpell(measure)).toBeNull();
  });
});
