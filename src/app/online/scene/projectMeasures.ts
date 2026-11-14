/**
 * Atlas's kept measures (`objects.measures`: areas, rulers, auras, and the spells and templates Tabletop and Connect
 * keep there) as players are sent them. An allowlist, field by field: what draws a measure, never who it is hidden from
 * or where it started (`hidden`, `origin`), never its light (a light of the scene reaches players as sight), never a
 * token players are not sent. Who sees a measure is Atlas's own rule (`measureShownToPlayers`): not a hidden one, not
 * one that started on a token players did not see then or do not see now, and an aura only with its token.
 *
 * A spell's `tabletop` field goes as `readExtra` reads it (known keys only), its rules checked and its words cut as a
 * cast's always were, its caster only where players are sent that token.
 */
import { readExtra, type TabletopExtra } from '../../../../packages/atlas-host/src/spellMeasure';
import { cutCastWords, cleanRules, isDamageType, isSpellRules } from '../tools/spells';
import { SCENE_LIMITS, SCENE_RANGES } from './sceneLimits';
import { byteLength } from './sceneMessages';
import { PLAYER_MEASURE_EFFECTS, PLAYER_MEASURE_SHAPES, type PlayerMeasure, type ScenePoint } from './sceneTypes';
import { isSceneId } from './sceneValidation';

/** The most bytes a scene's measures take of a message (a snapshot carries the whole scene in one). */
export const MEASURE_BUDGET_BYTES = 64 * 1024;

export interface MeasureAudience {
  /** Players see nothing but the dark map (a curtain, a closed lighting frame): no measure is sent. */
  closed: boolean;
  /** Whether players are sent the token `tokenId` now. */
  seen: (tokenId: string) => boolean;
}

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const HEX = /^#[0-9a-f]{6}$/i;
const within = (value: unknown, [min, max]: readonly [number, number]): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

function pointsOf(shape: string, raw: unknown): ScenePoint[] | null {
  if (!Array.isArray(raw)) return null;
  const most = shape === 'ruler' ? SCENE_LIMITS.measurePoints : 2;
  if (raw.length < 2 || raw.length > most) return null;
  const points: ScenePoint[] = [];
  for (const point of raw as unknown[]) {
    if (!isRec(point) || !within(point.x, SCENE_RANGES.coordinate) || !within(point.y, SCENE_RANGES.coordinate)) return null;
    points.push({ x: point.x, y: point.y });
  }
  return points;
}

/** Whether Atlas's players' picture shows the measure: its `hidden` and its origin, read closed (an origin that cannot be read hides it). */
function shown(measure: Rec, seen: (tokenId: string) => boolean): boolean {
  if (measure.hidden === true) return false;
  const origin = measure.origin;
  if (origin === undefined) return true;
  if (!isRec(origin) || origin.unseenAtStart !== false || !Array.isArray(origin.tokenIds)) return false;
  return origin.tokenIds.every((id) => typeof id === 'string' && seen(id));
}

/** A spell's or a template's extra field as players get it. */
function extraFor(measure: Rec, seen: (tokenId: string) => boolean): TabletopExtra | null {
  const extra = readExtra(measure);
  if (!extra) return null;
  const { caster, rules, about, name, effect, ...rest } = extra;
  const words = name !== undefined ? cutCastWords({ name, ...(about !== undefined ? { about: about as never } : {}) }) : {};
  return {
    ...rest,
    ...(isDamageType(effect) ? { effect } : {}),
    ...(caster !== undefined && seen(caster) ? { caster } : {}),
    ...(isSpellRules(rules) ? { rules: cleanRules(rules) } : {}),
    ...words,
  };
}

function project(measure: Rec, audience: MeasureAudience): PlayerMeasure | null {
  const shape = measure.shape;
  if (typeof shape !== 'string' || !(PLAYER_MEASURE_SHAPES as readonly string[]).includes(shape)) return null;
  const points = pointsOf(shape, measure.points);
  if (!points || !shown(measure, audience.seen)) return null;
  // An aura is both of its fields on a circle (Atlas's `isAura`), and is seen with its token.
  const aura = shape === 'circle' && typeof measure.follows === 'string' && measure.follows !== '' && within(measure.aura, SCENE_RANGES.auraReach) && measure.aura > 0
    ? { token: measure.follows, reach: measure.aura } : null;
  if (aura && !audience.seen(aura.token)) return null;
  const extra = extraFor(measure, audience.seen);
  return {
    shape: shape as PlayerMeasure['shape'],
    points,
    ...(within(measure.width, SCENE_RANGES.lineWidth) && measure.width > 0 ? { width: measure.width } : {}),
    ...(typeof measure.color === 'string' && HEX.test(measure.color) ? { color: measure.color } : {}),
    ...(measure.walls === false ? { walls: false as const } : {}),
    ...(typeof measure.effect === 'string' && (PLAYER_MEASURE_EFFECTS as readonly string[]).includes(measure.effect) ? { effect: measure.effect as NonNullable<PlayerMeasure['effect']> } : {}),
    ...(extra?.owner !== undefined ? { owner: extra.owner } : {}),
    ...(aura ? { aura } : {}),
    ...(extra ? { tabletop: extra } : {}),
  };
}

/** The measures of a scene (those of the level shown) as its players get them, by Atlas's ids, in the order they were made. */
export function projectMeasures(measures: unknown, audience: MeasureAudience): Record<string, PlayerMeasure> {
  const sent: Record<string, PlayerMeasure> = {};
  if (audience.closed || !isRec(measures)) return sent;
  let count = 0;
  for (const [id, value] of Object.entries(measures)) {
    if (count >= SCENE_LIMITS.measures) break;
    if (!isSceneId(id) || !isRec(value)) continue;
    const measure = project(value, audience);
    if (!measure) continue;
    sent[id] = measure;
    count++;
  }
  if (byteLength(sent) <= MEASURE_BUDGET_BYTES) return sent;
  // Too much for a message: the spells' words go first, then the newest measures.
  for (const measure of Object.values(sent)) if (measure.tabletop?.about !== undefined) delete measure.tabletop.about;
  let size = byteLength(sent);
  const ids = Object.keys(sent);
  while (size > MEASURE_BUDGET_BYTES && ids.length > 0) {
    const last = ids.pop()!;
    size -= byteLength(sent[last]) + byteLength(last) + 2;
    delete sent[last];
  }
  return sent;
}
