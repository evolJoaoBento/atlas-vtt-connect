/**
 * A scene's measures (`PlayerScene.measures`: Atlas's kept measures as players get them) as the player's views draw
 * them. Nothing is kept here: both lists are worked out again from the scene whenever its measures change.
 *
 * - `templatesOfMeasures`: every measure flat on the map, as the 2D views draw it (an area between its two points, a
 *   kept ruler as its legs, one that follows a token around that token), with what it is (`kind`), so the 3D board can leave a spell's flat mark to its 3D shape.
 * - `spellsOfMeasures`: the measures that hold a spell, as the cast the 3D board draws (`MapSpell`).
 */
import { measureKind, measureToSpell, readExtra } from '../../../../packages/atlas-host/src/spellMeasure';
import type { PlayerMeasure } from '../scene/sceneTypes';
import { GM_LASER_ID } from './laserColors';
import { isSpell, isSpellAbout, isSpellRules, type MapSpell } from './spells';
import type { MapTemplate } from './templates';

/** The colour of a spell that names none: the GM's white, as the board always cast the GM's. */
const PLAIN_SPELL = '#ffffff';

/** What of the scene's tokens places a measure that follows one (`PlayerMeasure.aura`). */
export interface MeasureLook {
  /** Where the token stands (its centre); null when the scene has no such token. Without it, no measure that follows a token is drawn. */
  tokenAt?: (tokenId: string) => { x: number; y: number } | null;
}

/**
 * A measure where it lies now: one that follows a token is moved to lie around it, as large as it was last made (its
 * points are where it lay when it was last edited; Atlas places it from the token). Null when its token is not here.
 */
function placed(measure: PlayerMeasure, tokenAt: MeasureLook['tokenAt']): PlayerMeasure | null {
  if (!measure.aura) return measure;
  const at = tokenAt?.(measure.aura.token) ?? null;
  const origin = measure.points[0];
  if (!at || !origin) return null;
  const dx = at.x - origin.x;
  const dy = at.y - origin.y;
  return dx === 0 && dy === 0 ? measure : { ...measure, points: measure.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
}

/**
 * The scene's measures as flat templates, in the order they were made. `cell` is the map's cell size (a line that
 * names no width is one cell wide, as Atlas draws it); `accent` colours a measure that names no colour.
 */
export function templatesOfMeasures(measures: Readonly<Record<string, PlayerMeasure>>, look: MeasureLook & { cell: number; accent: string }): MapTemplate[] {
  const templates: MapTemplate[] = [];
  for (const [id, kept] of Object.entries(measures)) {
    const measure = placed(kept, look.tokenAt);
    if (!measure) continue;
    const shared = { owner: measure.owner ?? readExtra(measure)?.owner ?? GM_LASER_ID, color: measure.color ?? look.accent, kind: measureKind(measure), ...(measure.effect !== undefined ? { effect: measure.effect } : {}) };
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
export function spellsOfMeasures(measures: Readonly<Record<string, PlayerMeasure>>, look: MeasureLook = {}): MapSpell[] {
  const spells: MapSpell[] = [];
  for (const [id, kept] of Object.entries(measures)) {
    const measure = placed(kept, look.tokenAt);
    if (!measure) continue;
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
