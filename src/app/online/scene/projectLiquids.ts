/**
 * The water, lava and acid of a scene, for players (Atlas 0.10: generated dungeons and `objects.liquids`). A liquid is a
 * polygon with holes in the scene's world, of one kind, with the three colours Atlas draws it with. Atlas draws them in a
 * shader layer over the map, under the fog, so they are map art and not something players must not see: like the map
 * image they go out whole, and the fog covers them where players have not been (the map image is sent whole too).
 * Here they are drawn still, in their surface colour; their flow and shimmer are Atlas's own shader.
 *
 * Everything is read field by field and clipped to the limits below: a liquid Atlas could not have made is left out, a
 * colour it could not have written is the kind's own.
 */
import { finiteOrNull } from './coerce';
import { SCENE_RANGES } from './sceneLimits';
import type { PlayerLiquid, ScenePoint } from './sceneTypes';

export const LIQUID_KINDS = ['water', 'lava', 'acid'] as const;

export const LIQUID_LIMITS = {
  /** Liquids in a scene. */
  liquids: 64,
  /** Points in one outline, and holes in one liquid. */
  points: 2048,
  holes: 16,
  /** Points in all the liquids of a scene. */
  totalPoints: 20_000,
} as const;

/** What a kind is drawn in where its colours are missing or not `#rrggbb`. */
const DEFAULT_COLORS: Readonly<Record<PlayerLiquid['liquid'], PlayerLiquid['colors']>> = {
  water: { surface: '#3b82f6', deep: '#1e3a8a', glint: '#93c5fd' },
  lava: { surface: '#ea580c', deep: '#7c2d12', glint: '#fde047' },
  acid: { surface: '#84cc16', deep: '#365314', glint: '#d9f99d' },
};
const HEX = /^#[0-9a-f]{6}$/i;

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** An outline of at least three points, each a finite point in the scene's range; null for anything else. */
function readRing(value: unknown): ScenePoint[] | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > LIQUID_LIMITS.points) return null;
  const ring: ScenePoint[] = [];
  for (const item of value) {
    if (!isObject(item)) return null;
    const x = finiteOrNull(item.x, SCENE_RANGES.coordinate);
    const y = finiteOrNull(item.y, SCENE_RANGES.coordinate);
    if (x === null || y === null) return null;
    ring.push({ x, y });
  }
  return ring;
}

function readColors(value: unknown, liquid: PlayerLiquid['liquid']): PlayerLiquid['colors'] {
  const own = DEFAULT_COLORS[liquid];
  if (!isObject(value)) return own;
  const pick = (key: keyof PlayerLiquid['colors']): string => (typeof value[key] === 'string' && HEX.test(value[key]) ? value[key].toLowerCase() : own[key]);
  return { surface: pick('surface'), deep: pick('deep'), glint: pick('glint') };
}

/** The liquids of `record` (Atlas's `objects.liquids`) as players receive them; none for anything that is not a record of them. */
export function projectLiquids(record: unknown): PlayerLiquid[] {
  if (!isObject(record)) return [];
  const liquids: PlayerLiquid[] = [];
  let points = 0;
  for (const entry of Object.values(record)) {
    if (liquids.length >= LIQUID_LIMITS.liquids) break;
    if (!isObject(entry) || entry.kind !== 'liquid') continue;
    const liquid = LIQUID_KINDS.find((kind) => kind === entry.liquid);
    const polygon = readRing(entry.polygon);
    if (!liquid || !polygon) continue;
    const holes = (Array.isArray(entry.holes) ? entry.holes : []).slice(0, LIQUID_LIMITS.holes).map(readRing).filter((hole): hole is ScenePoint[] => hole !== null);
    const size = polygon.length + holes.reduce((sum, hole) => sum + hole.length, 0);
    if (points + size > LIQUID_LIMITS.totalPoints) continue;
    points += size;
    liquids.push({ liquid, polygon, ...(holes.length > 0 ? { holes } : {}), colors: readColors(entry.colors, liquid) });
  }
  return liquids;
}
