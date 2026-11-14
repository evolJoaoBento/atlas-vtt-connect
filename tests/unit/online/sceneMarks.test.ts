import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spellToMeasure, type SpellLike } from '../../../packages/atlas-host/src/spellMeasure';
import type { PlayerMeasure } from '../../../src/app/online/scene/sceneTypes';
import { FLASH_MS, SceneMarks } from '../../../src/app/online/tools/sceneMarks';
import type { MapSpell, SpellRequest } from '../../../src/app/online/tools/spells';
import type { MapTemplate } from '../../../src/app/online/tools/templates';
import { playerScene } from './sceneFixtures';

const spell: SpellLike = { shape: 'sphere', from: 'point', at: { x: 700, y: 420, h: 70 }, yaw: 0, pitch: 0, roll: 0, size: 140, length: 0, angle: 1 };
const kept = JSON.parse(JSON.stringify(spellToMeasure(spell, { owner: 'p1', color: '#3366ff', name: 'Web' }))) as PlayerMeasure;
const area: PlayerMeasure = { shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] };
const flash: MapSpell = { id: 'f1', owner: 'p2', color: '#ff0059', spell: { ...spell, effect: 'fire' } as MapSpell['spell'], name: 'Fireball' };
const ask: SpellRequest = { id: 'a1', tokenId: 'wizard', ask: { shape: 'sphere', from: 'point', size: 70, length: 0 } };

function world() {
  const templates: Array<[string, MapTemplate[]]> = [];
  const spells: Array<[string, MapSpell[], SpellRequest[]]> = [];
  const marks = new SceneMarks({ templates: (sceneId, list) => templates.push([sceneId, [...list]]), spells: (sceneId, list, asks) => spells.push([sceneId, [...list], [...asks]]) });
  return { marks, templates, spells };
}

describe("what a player's views draw of a scene's measures", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("gives the views the scene's templates and spells whenever its measures change, and only then", () => {
    const w = world();
    const first = playerScene({ measures: { area, kept } });
    w.marks.scene(first);
    expect(w.templates.at(-1)![1].map((template) => [template.id, template.kind])).toEqual([['area', 'area'], ['kept', 'spell']]);
    expect(w.spells.at(-1)![1].map((cast) => [cast.id, cast.name, cast.owner])).toEqual([['kept', 'Web', 'p1']]);
    // The same measures (a token moved): nothing is told again.
    w.marks.scene({ ...first, tokens: {} });
    expect([w.templates.length, w.spells.length]).toEqual([1, 1]);
    w.marks.scene({ ...first, measures: { area } });
    expect(w.templates.at(-1)![1].map((template) => template.id)).toEqual(['area']);
    expect(w.spells.at(-1)![1]).toEqual([]);
    // No scene: nothing to draw.
    w.marks.scene(null);
    expect([w.templates.length, w.spells.length]).toEqual([2, 2]);
  });

  it("carries the GM's asks with the spells, for the scene they are for", () => {
    const w = world();
    w.marks.scene(playerScene({ measures: { kept } }));
    w.marks.asks('scene-1', [ask]);
    expect(w.spells.at(-1)).toEqual(['scene-1', [expect.objectContaining({ id: 'kept' })], [ask]]);
    // Asks of another scene wait for it.
    w.marks.asks('scene-2', []);
    expect(w.spells).toHaveLength(2);
    w.marks.scene(playerScene({ sceneId: 'scene-2', measures: {} }));
    expect(w.spells.at(-1)).toEqual(['scene-2', [], []]);
  });

  it('an instantaneous spell is among the spells while it goes off, then gone; it is kept nowhere', () => {
    const w = world();
    w.marks.scene(playerScene({ measures: { kept } }));
    w.marks.flash('scene-1', flash);
    expect(w.spells.at(-1)![1].map((cast) => cast.id)).toEqual(['kept', 'f1']);
    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(w.spells).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(w.spells.at(-1)![1].map((cast) => cast.id)).toEqual(['kept']);
    // A flash of a scene the player does not have is not shown; one left behind by a scene change goes with it.
    w.marks.flash('scene-9', flash);
    expect(w.spells).toHaveLength(3);
    w.marks.flash('scene-1', flash);
    w.marks.scene(playerScene({ sceneId: 'scene-2', measures: {} }));
    expect(w.spells.at(-1)).toEqual(['scene-2', [], []]);
    w.marks.dispose();
    vi.advanceTimersByTime(FLASH_MS * 2);
    expect(w.spells).toHaveLength(5);
  });
});
