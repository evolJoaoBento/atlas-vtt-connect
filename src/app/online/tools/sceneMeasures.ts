/**
 * A scene's measures (`PlayerScene.measures`: Atlas's kept measures as players get them) as the player's views draw
 * them. Nothing is kept here: both lists are worked out again from the scene whenever its measures change.
 *
 * - `templatesOfMeasures`: every measure flat on the map but a token's aura, as the 2D views draw it (an area between
 *   its two points, a kept ruler as its legs), with what it is (`kind`), so the 3D board can leave a spell's flat mark to its 3D shape.
 * - `spellsOfMeasures`: the measures that hold a spell, as the cast the 3D board draws (`MapSpell`).
 */
import { measureToSpell, readExtra } from '../../../../packages/atlas-host/src/spellMeasure';
import type { PlayerMeasure } from '../scene/sceneTypes';
import { GM_LASER_ID } from './laserColors';
import { isSpell, isSpellAbout, isSpellRules, type MapSpell } from './spells';
import type { MapTemplate } from './templates';

/** The colour of a spell that names none: the GM's white, as the board always cast the GM's. */
const PLAIN_SPELL = '#ffffff';

/** What a measure is, by its `tabletop` field. */
function kindOf(measure: PlayerMeasure): NonNullable<MapTemplate['kind']> {
  const extra = readExtra(measure);
  return extra?.kind === 'template' ? 'template' : extra?.kind === 'spell' ? 'spell' : 'area';
}

/**
 * The scene's measures as flat templates, in the order they were made. `cell` is the map's cell size (a line that
 * names no width is one cell wide, as Atlas draws it); `accent` colours a measure that names no colour.
 */
export function templatesOfMeasures(measures: Readonly<Record<string, PlayerMeasure>>, look: { cell: number; accent: string }): MapTemplate[] {
  const templates: MapTemplate[] = [];
  for (const [id, measure] of Object.entries(measures)) {
    // An aura lies around its token wherever that stands, not where its points were last written: not drawn here yet.
    if (measure.aura) continue;
    const shared = { owner: measure.owner ?? readExtra(measure)?.owner ?? GM_LASER_ID, color: measure.color ?? look.accent, kind: kindOf(measure), ...(measure.effect !== undefined ? { effect: measure.effect } : {}) };
    if (measure.shape === 'ruler') {
      for (let leg = 0; leg + 1 < measure.points.length; leg++) {
        templates.push({ id: `${id}:${leg}`, shape: 'line', start: measure.points[leg]!, end: measure.points[leg + 1]!, ruler: true, ...shared });
      }
      continue;
    }
    const [start, end] = measure.points;
    if (!start || !end) continue;
    templates.push({ id, shape: measure.shape, start, end, ...(measure.shape === 'line' ? { width: measure.width ?? look.cell } : {}), ...shared });
  }
  return templates;
}

/** The scene's kept spells as casts, in the order they were made: each read back from its measure where it lies now. */
export function spellsOfMeasures(measures: Readonly<Record<string, PlayerMeasure>>): MapSpell[] {
  const spells: MapSpell[] = [];
  for (const [id, measure] of Object.entries(measures)) {
    const read = measureToSpell(measure);
    if (!read || !isSpell(read.spell)) continue;
    const { rules, about, name } = read.meta;
    spells.push({
      id, owner: measure.owner ?? read.meta.owner ?? GM_LASER_ID, color: measure.color ?? PLAIN_SPELL, spell: read.spell,
      ...(isSpellRules(rules) ? { rules } : {}),
      ...(name !== undefined ? { name } : {}),
      ...(isSpellAbout(about) ? { about } : {}),
    });
  }
  return spells;
}
