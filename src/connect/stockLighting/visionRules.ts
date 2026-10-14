/**
 * The rules of Atlas VTT's sight and light that decide what the players' window shows of a lit scene, ported
 * from Atlas VTT 0.8.0 (`gameSystems/senseRules.ts`, `gameSystems/senses/generic.ts`, `vision/lightLevels.ts`,
 * `lighting/sceneLightingOptions.ts`, `vision/visibility.ts`), which are the same files in 0.7.1. Atlas VTT is
 * AGPL-3.0, like this plugin. A stock Atlas has no way to ask for them: its bundle keeps them out of reach, so the
 * answer of its player window is worked out here from the sight, ambient light and light reaches its lighting
 * hands out. Only what the darkness raster reads is ported.
 */

export interface Point {
  x: number;
  y: number;
}
export type Polygon = Point[];

export type LightLevel = 'bright' | 'dim' | 'dark' | 'magical-dark';
export type Seeing = 'none' | 'normal' | 'as-bright' | 'as-dim';

/** What a sense perceives at each light level. */
export interface SenseSight {
  bright: Seeing;
  dim: Seeing;
  dark: Seeing;
  magicalDark: Seeing;
}

/** The fields of a sense definition the rules read. */
export interface SenseRules {
  sees: SenseSight;
  reveals: 'all' | 'creatures';
  lineOfSight: boolean;
  precise: boolean;
}

/** The sight every token with vision has: what is lit, as far as its sight range (`NORMAL_SIGHT`). */
export const NORMAL_SIGHT: SenseRules = {
  sees: { bright: 'normal', dim: 'normal', dark: 'none', magicalDark: 'none' },
  reveals: 'all',
  lineOfSight: true,
  precise: true,
};

export interface AmbientZone {
  polygon: Polygon;
  ambient: number;
}

/** The scene's light without its sources. */
export interface AmbientLight {
  ambient: number;
  litThreshold?: number;
  brightThreshold?: number;
  zones?: readonly AmbientZone[];
}

/** The area a light illuminates, in world pixels. */
export interface LightReach {
  origin: Point;
  bright: number;
  dim: number;
  polygon: Polygon;
  darkness?: boolean;
  priority?: number;
}

export interface SightRegion {
  sense: SenseRules;
  origin: Point;
  radius: number;
  /** Null for a sense that walls do not stop. */
  polygon: Polygon | null;
}

export interface Sight {
  all: boolean;
  regions: SightRegion[];
}

const DEFAULT_LIT_THRESHOLD = 0.25;
const DEFAULT_BRIGHT_THRESHOLD = 0.75;

const clampLit = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_LIT_THRESHOLD);
const litThresholdOf = (light: Pick<AmbientLight, 'litThreshold'>): number => (light.litThreshold === undefined ? DEFAULT_LIT_THRESHOLD : clampLit(light.litThreshold));

function brightThresholdOf(light: Pick<AmbientLight, 'litThreshold' | 'brightThreshold'>): number {
  const bright = light.brightThreshold;
  const wanted = bright === undefined || !Number.isFinite(bright) ? DEFAULT_BRIGHT_THRESHOLD : bright;
  return Math.min(1, Math.max(litThresholdOf(light), wanted));
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(point: Point, polygon: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The light level the scene's ambient light alone gives every point. */
export function ambientLevel(light: AmbientLight): LightLevel {
  if (light.ambient < litThresholdOf(light)) return 'dark';
  return light.ambient >= brightThresholdOf(light) ? 'bright' : 'dim';
}

function ambientAt(point: Point, light: AmbientLight): number {
  const { zones } = light;
  if (zones) {
    for (let i = zones.length - 1; i >= 0; i--) if (pointInPolygon(point, zones[i]!.polygon)) return zones[i]!.ambient;
  }
  return light.ambient;
}

function ambientLevelAt(point: Point, light: AmbientLight): LightLevel {
  return light.zones?.length ? ambientLevel({ ...light, ambient: ambientAt(point, light) }) : ambientLevel(light);
}

function levelFromLights(point: Point, lights: readonly LightReach[], above = -Infinity): LightLevel {
  let level: LightLevel = 'dark';
  for (const light of lights) {
    if (light.darkness || (light.priority ?? 0) <= above) continue;
    const distance = Math.hypot(point.x - light.origin.x, point.y - light.origin.y);
    if (distance > light.dim || !pointInPolygon(point, light.polygon)) continue;
    if (distance <= light.bright) return 'bright';
    level = 'dim';
  }
  return level;
}

function darknessAt(point: Point, lights: readonly LightReach[]): number {
  let priority = -Infinity;
  for (const light of lights) {
    if (!light.darkness || (light.priority ?? 0) <= priority) continue;
    if (Math.hypot(point.x - light.origin.x, point.y - light.origin.y) <= light.dim && pointInPolygon(point, light.polygon)) priority = light.priority ?? 0;
  }
  return priority;
}

/** How well `point` is lit: the brightest of the ambient light there and every light that reaches it; darkness sources outrank by priority. */
export function lightLevelAt(point: Point, ambient: AmbientLight, lights: readonly LightReach[]): LightLevel {
  const darkness = darknessAt(point, lights);
  if (darkness > -Infinity) {
    const outshining = levelFromLights(point, lights, darkness);
    return outshining === 'dark' ? 'magical-dark' : outshining;
  }
  const fromAmbient = ambientLevelAt(point, ambient);
  if (fromAmbient === 'bright') return 'bright';
  const fromLights = levelFromLights(point, lights);
  return fromLights === 'dark' ? fromAmbient : fromLights;
}

/** Whether the sense shows the map with the tokens on it: only a sense walls stop. */
export function showsMap(sense: Pick<SenseRules, 'reveals' | 'lineOfSight'>): boolean {
  return sense.reveals === 'all' && sense.lineOfSight;
}

/** The light level a point at `level` counts as for a token perceiving it through `sense`: bright, dim, or null for nothing. */
export function perceivedLevel(sense: Pick<SenseRules, 'sees'>, level: LightLevel): 'bright' | 'dim' | null {
  const seeing = level === 'magical-dark' ? sense.sees.magicalDark : sense.sees[level];
  switch (seeing) {
    case 'none': return null;
    case 'as-bright': return 'bright';
    case 'as-dim': return 'dim';
    case 'normal': return level === 'dim' ? 'dim' : 'bright';
  }
}
