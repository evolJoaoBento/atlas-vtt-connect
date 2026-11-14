import { describe, expect, it } from 'vitest';
import { spellToMeasure, templateToMeasure, type SpellLike } from '../../../packages/atlas-host/src/spellMeasure';
import type { PlayerMeasure } from '../../../src/app/online/scene/sceneTypes';
import { spellsOfMeasures, templatesOfMeasures } from '../../../src/app/online/tools/sceneMeasures';
import { templateContains, templateLabelAt, templateOutline, templateSpan, type MapTemplate } from '../../../src/app/online/tools/templates';

const spell: SpellLike = { shape: 'sphere', from: 'point', at: { x: 700, y: 420, h: 70 }, yaw: 0, pitch: 0, roll: 0, size: 140, length: 0, angle: 1, effect: 'fire' };
const sent = (record: object): PlayerMeasure => JSON.parse(JSON.stringify(record)) as PlayerMeasure;
const QUARTER = Math.PI / 2;

describe("a scene's measures as the page and the board draw them", () => {
  const measures: Record<string, PlayerMeasure> = {
    area: { shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], effect: 'frost' },
    wide: { shape: 'line', points: [{ x: 0, y: 0 }, { x: 140, y: 0 }], width: 35, color: '#ff8800' },
    path: { shape: 'ruler', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 70 }] },
    mine: { ...sent(templateToMeasure({ shape: 'cone', start: { x: 0, y: 0 }, end: { x: 70, y: 0 } }, { owner: 'p1', by: 'Ana', color: '#22c55e' })), owner: 'p1' },
    cast: { ...sent(spellToMeasure(spell, { owner: 'p2', color: '#3366ff', name: 'Fireball', rules: { difficult: true } })), owner: 'p2' },
  };

  it('a measure that follows a token lies around that token, not where its points were last written; with no such token it is not drawn', () => {
    const aura: PlayerMeasure = { shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], aura: { token: 't1', reach: 10 } };
    const tokenAt = (id: string) => (id === 't1' ? { x: 500, y: 300 } : null);
    expect(templatesOfMeasures({ aura }, { cell: 70, accent: '#7c5cff' })).toEqual([]);
    expect(templatesOfMeasures({ aura }, { cell: 70, accent: '#7c5cff', tokenAt })).toMatchObject([{ start: { x: 500, y: 300 }, end: { x: 570, y: 300 } }]);
    // A spell the GM made follow its caster (Spirit Guardians) goes with the token in 3D too.
    const guardians: PlayerMeasure = { ...sent(spellToMeasure({ ...spell, at: { x: 0, y: 0, h: 0 } })), aura: { token: 't1', reach: 10 } };
    const [cast] = spellsOfMeasures({ guardians }, { tokenAt });
    expect([Math.round(cast!.spell.at.x), Math.round(cast!.spell.at.y)]).toEqual([500, 300]);
    expect(spellsOfMeasures({ guardians })).toEqual([]);
  });

  it('a spell that no longer reads as one is drawn flat, as the area its points say', () => {
    const broken = { shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], tabletop: { v: 1, kind: 'spell' } } as PlayerMeasure;
    expect(spellsOfMeasures({ broken })).toEqual([]);
    expect(templatesOfMeasures({ broken }, { cell: 70, accent: '#7c5cff' }).map((template) => template.kind)).toEqual(['area']);
  });

  it('every area is a flat template: its shape, its two points, its colour, its maker, a line with its width', () => {
    const templates = templatesOfMeasures(measures, { cell: 70, accent: '#7c5cff' });
    expect(templates.map((template) => [template.id, template.shape, template.kind, template.owner, template.color])).toEqual([
      ['area', 'circle', 'area', 'gm', '#7c5cff'], ['wide', 'line', 'area', 'gm', '#ff8800'],
      ['path:0', 'line', 'area', 'gm', '#7c5cff'], ['path:1', 'line', 'area', 'gm', '#7c5cff'],
      ['mine', 'cone', 'template', 'p1', '#22c55e'], ['cast', 'circle', 'spell', 'p2', '#3366ff'],
    ]);
    expect(templates[1]).toMatchObject({ width: 35 });
    // A kept ruler is its legs, thin lines.
    expect(templates[2]).toMatchObject({ ruler: true, start: { x: 0, y: 0 }, end: { x: 70, y: 0 } });
    expect(templates[3]).toMatchObject({ ruler: true, start: { x: 70, y: 0 }, end: { x: 70, y: 70 } });
    expect(templates[0]).toMatchObject({ effect: 'frost' });
  });

  it("a spell reads back as the cast that made it, with its owner's colour, its name and its rules", () => {
    const spells = spellsOfMeasures(measures);
    expect(spells).toHaveLength(1);
    expect(spells[0]).toMatchObject({ id: 'cast', owner: 'p2', color: '#3366ff', name: 'Fireball', rules: { difficult: true }, spell: { shape: 'sphere', from: 'point', effect: 'fire' } });
    expect(spells[0]!.spell.size).toBeCloseTo(140, 6);
    expect(spellsOfMeasures({})).toEqual([]);
    // A spell nobody is named for is the GM's, in white.
    const anonymous = spellsOfMeasures({ s: sent(spellToMeasure(spell)) });
    expect([anonymous[0]!.owner, anonymous[0]!.color]).toEqual(['gm', '#ffffff']);
  });
});

describe('a template lies as Atlas shapes it', () => {
  const template = (shape: MapTemplate['shape'], extra: Partial<MapTemplate> = {}): MapTemplate => ({ id: 't', owner: 'p', shape, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, color: '#ffffff', ...extra });

  it('a square runs from the middle of its near side, as long and as wide as the drag', () => {
    const outline = templateOutline(template('square'), QUARTER)!;
    expect(outline).toEqual([{ x: 0, y: -50 }, { x: 0, y: 50 }, { x: 100, y: 50 }, { x: 100, y: -50 }]);
    expect(templateContains(template('square'), { x: 90, y: 40 }, QUARTER, 0)).toBe(true);
    expect(templateContains(template('square'), { x: 90, y: 60 }, QUARTER, 0)).toBe(false);
    expect(templateContains(template('square'), { x: -10, y: 0 }, QUARTER, 0)).toBe(false);
    expect(templateLabelAt(template('square'))).toEqual({ x: 50, y: 0 });
    expect(templateSpan(template('square'))).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  it('a line is as wide as it says; a ruler leg is a thin line', () => {
    const wide = template('line', { width: 40 });
    expect(templateOutline(wide, QUARTER)).toEqual([{ x: 0, y: -20 }, { x: 0, y: 20 }, { x: 100, y: 20 }, { x: 100, y: -20 }]);
    expect(templateContains(wide, { x: 50, y: 19 }, QUARTER, 0)).toBe(true);
    expect(templateContains(wide, { x: 50, y: 25 }, QUARTER, 0)).toBe(false);
    const leg = template('line', { ruler: true });
    expect(templateOutline(leg, QUARTER)).toBeNull();
    expect(templateContains(leg, { x: 50, y: 1 }, QUARTER, 2)).toBe(true);
    expect(templateContains(leg, { x: 50, y: 4 }, QUARTER, 2)).toBe(false);
  });

  it('a circle and a cone hold what lies in them; a slack reaches a little past the edge', () => {
    expect(templateContains(template('circle'), { x: 60, y: 60 }, QUARTER, 0)).toBe(true);
    expect(templateContains(template('circle'), { x: 110, y: 0 }, QUARTER, 0)).toBe(false);
    expect(templateContains(template('circle'), { x: 104, y: 0 }, QUARTER, 5)).toBe(true);
    expect(templateOutline(template('circle'), QUARTER)).toBeNull();
    expect(templateContains(template('cone'), { x: 80, y: 10 }, QUARTER, 0)).toBe(true);
    expect(templateContains(template('cone'), { x: -5, y: 0 }, QUARTER, 0)).toBe(false);
    expect(templateOutline(template('cone'), QUARTER)![0]).toEqual({ x: 0, y: 0 });
  });
});
