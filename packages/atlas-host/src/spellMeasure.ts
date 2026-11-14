/**
 * A spell or a player's template as an Atlas measure (`objects.measures`), and back. Atlas's store is the only place
 * they live: the measure's two points say where it lies, which way it runs and how big it is, as Atlas and the 2D
 * views draw it; a `tabletop` field on the measure holds only what points cannot say (its 3D shape, its height and
 * tilt, its damage, its words and rules), with the spell's anchor, turn and sizes kept **relative to those points**. So
 * a measure moved, turned or resized in Atlas carries its 3D shape with it, and nothing kept here goes stale.
 *
 * The board's space: x is the map's x, the map's y runs down; a spell's `yaw` turns its forward, which lies along
 * (-sin yaw, -cos yaw) on the floor. Pure: no Obsidian, no three.js. Shared by Connect and Tabletop.
 */

export type SpellShape = 'sphere' | 'cube' | 'cylinder' | 'cone' | 'wall';
export const SPELL_SHAPE_NAMES: readonly SpellShape[] = ['sphere', 'cube', 'cylinder', 'cone', 'wall'];

interface FloorPoint { x: number; y: number }

/** A spell as both plugins hold it (Tabletop's `Spell`, Connect's `Spell`): map pixels, radians. */
export interface SpellLike {
  shape: SpellShape;
  from: 'self' | 'point';
  at: { x: number; y: number; h: number };
  to?: FloorPoint;
  yaw: number;
  pitch: number;
  roll: number;
  size: number;
  length: number;
  angle: number;
  caster?: string;
  effect?: string;
}

/** What goes with a spell on its measure: who made it, its colour, its name, words and rules, and whether only the GM sees it. */
export interface SpellMeta {
  /** A stable id of who made it (a player's id; unset is the GM). */
  owner?: string;
  /** Their name, as Atlas shows it (`KeptMeasure.by`). */
  by?: string;
  color?: string;
  name?: string;
  about?: unknown;
  rules?: unknown;
  hidden?: boolean;
}

/** An Atlas kept measure, as far as this reads and writes it. */
export interface MeasureRecord {
  id?: string;
  shape: 'ruler' | 'circle' | 'cone' | 'square' | 'line';
  points: FloorPoint[];
  width?: number;
  color?: string;
  hidden?: true;
  by?: string;
  light?: unknown;
  effect?: string;
  tabletop?: unknown;
}

/** The spell's anchor, turn and sizes in the measure's own frame: offsets and sizes in units of its points' distance, the turn from their heading. */
interface Relative {
  ax: number;
  ay: number;
  turn: number;
  size: number;
  length: number;
  /** A wall's other end. */
  tx?: number;
  ty?: number;
}

/** The `tabletop` field of a measure. */
export interface TabletopExtra {
  v: 1;
  kind: 'spell' | 'template';
  shape?: SpellShape;
  from?: 'self' | 'point';
  rel?: Relative;
  h?: number;
  pitch?: number;
  roll?: number;
  angle?: number;
  /** The spell's damage (Tabletop's fourteen), whatever look Atlas has for it. */
  effect?: string;
  caster?: string;
  owner?: string;
  name?: string;
  about?: unknown;
  rules?: unknown;
  /** A player's template: it goes when they leave, place another, or a session starts. */
  temp?: true;
}

/** Kept spells per player and per scene (checked by the GM before writing), Atlas's own cap per level, and the longest words. */
export const MEASURE_LIMITS = { perPlayer: 10, perScene: 40, perLevel: 256, about: 4000, name: 60, id: 200, by: 128 } as const;
/** The largest a spell's size may be, map pixels (Tabletop's `SPELL_MAX_SIZE`). */
const MAX_SIZE = 20000;

/** The chain id of the Atlas walls a spell's rules stand, by its measure's id. */
export const SPELL_CHAIN = (measureId: string): string => `spell:${measureId}`;

const ATLAS_LOOK: Readonly<Record<string, string>> = { fire: 'fire', cold: 'frost', lightning: 'lightning', radiant: 'radiance', necrotic: 'shadow' };
const DAMAGE_OF: Readonly<Record<string, string>> = { fire: 'fire', frost: 'cold', lightning: 'lightning', radiance: 'radiant', shadow: 'necrotic' };

/** Atlas's look for a damage type: one of its six where it has one, else none (the plain wash). */
export function atlasEffectOf(damage: string | undefined): string | undefined {
  return damage !== undefined && Object.hasOwn(ATLAS_LOOK, damage) ? ATLAS_LOOK[damage] : undefined;
}

/** The damage type an Atlas look sounds as on the board; none for mist and anything unknown. */
export function damageOfEffect(effect: string | undefined): string | undefined {
  return effect !== undefined && Object.hasOwn(DAMAGE_OF, effect) ? DAMAGE_OF[effect] : undefined;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPlace = (value: unknown): value is FloorPoint => isRecord(value) && finite(value.x) && finite(value.y);
const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : undefined);

/** The floor direction a yaw looks along. */
const headingOf = (yaw: number): FloorPoint => ({ x: -Math.sin(yaw), y: -Math.cos(yaw) });
/** The yaw that looks along a floor direction given as an angle (atan2 of y, x). */
const yawOf = (angle: number): number => Math.atan2(-Math.cos(angle), -Math.sin(angle));

/** A measure's frame: its origin, the distance between its points and the angle they run at; null where they are no two places apart. */
function frameOf(points: readonly FloorPoint[]): { origin: FloorPoint; span: number; angle: number } | null {
  const [origin, end] = points;
  if (!isPlace(origin) || !isPlace(end)) return null;
  const span = Math.hypot(end.x - origin.x, end.y - origin.y);
  if (!(span > 1e-9) || !Number.isFinite(span)) return null;
  return { origin, span, angle: Math.atan2(end.y - origin.y, end.x - origin.x) };
}

const along = (from: FloorPoint, direction: FloorPoint, distance: number): FloorPoint => ({ x: from.x + direction.x * distance, y: from.y + direction.y * distance });

/** The words cut to the limit, where they are an object with a text. */
function cutAbout(about: unknown): unknown {
  if (!isRecord(about)) return undefined;
  return typeof about.text === 'string' && about.text.length > MEASURE_LIMITS.about ? { ...about, text: about.text.slice(0, MEASURE_LIMITS.about) } : about;
}

/** The two points a spell lies between on the floor, and the Atlas shape it reads as (D2 of the Phase 3 plan). */
function flatOf(spell: SpellLike): { shape: MeasureRecord['shape']; points: [FloorPoint, FloorPoint]; width?: number } {
  const at = { x: spell.at.x, y: spell.at.y };
  const ahead = headingOf(spell.yaw);
  const level = Math.cos(spell.pitch);
  switch (spell.shape) {
    case 'sphere':
      return { shape: 'circle', points: [at, along(at, ahead, spell.size)] };
    case 'cube': {
      // Atlas's square starts at the middle of its near side.
      const near = along(at, ahead, -spell.size / 2);
      return { shape: 'square', points: [near, along(near, ahead, spell.size)] };
    }
    case 'cone': {
      // Its length on the floor; a cone looking almost straight up or down still needs two points apart.
      const run = Math.max(spell.size * Math.abs(level), spell.size * 0.05);
      const tip = spell.from === 'self' ? at : along(at, ahead, -(spell.size / 2) * level);
      return { shape: 'cone', points: [tip, along(tip, ahead, run)] };
    }
    case 'cylinder': {
      const run = spell.length * level;
      // A beam running along the floor further than its radius is a line; a standing one is a column: a circle.
      if (Math.abs(run) > spell.size) {
        const near = spell.from === 'self' ? at : along(at, ahead, -run / 2);
        return { shape: 'line', points: [near, along(near, ahead, run)], width: spell.size * 2 };
      }
      return { shape: 'circle', points: [at, along(at, ahead, spell.size)] };
    }
    case 'wall': {
      const to = spell.to ?? at;
      const apart = Math.hypot(to.x - at.x, to.y - at.y) > 1e-6;
      return { shape: 'line', points: [at, apart ? { x: to.x, y: to.y } : along(at, { x: 1, y: 0 }, Math.max(spell.size, 1))], width: spell.size };
    }
  }
}

/** The measure a spell is kept as: its flat reading for Atlas and the 2D views, and the `tabletop` field its 3D shape is read back from. */
export function spellToMeasure(spell: SpellLike, meta: SpellMeta = {}): MeasureRecord {
  const flat = flatOf(spell);
  let frame = frameOf(flat.points);
  if (!frame) {
    // A spell with no size to speak of, or numbers that are none: still two places apart, one pixel, where it is.
    const origin = { x: Number.isFinite(spell.at.x) ? spell.at.x : 0, y: Number.isFinite(spell.at.y) ? spell.at.y : 0 };
    flat.points = [origin, { x: origin.x + 1, y: origin.y }];
    frame = { origin, span: 1, angle: 0 };
  }
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  const local = (point: FloorPoint): [number, number] => {
    const dx = point.x - frame.origin.x;
    const dy = point.y - frame.origin.y;
    return [(dx * cos + dy * sin) / frame.span, (-dx * sin + dy * cos) / frame.span];
  };
  const [ax, ay] = local(spell.at);
  const ahead = headingOf(spell.yaw);
  const rel: Relative = { ax, ay, turn: Math.atan2(ahead.y, ahead.x) - frame.angle, size: spell.size / frame.span, length: spell.length / frame.span };
  if (spell.shape === 'wall' && spell.to) [rel.tx, rel.ty] = local(spell.to);
  const about = cutAbout(meta.about);
  const extra: TabletopExtra = {
    v: 1, kind: 'spell', shape: spell.shape, from: spell.from, rel, h: spell.at.h, pitch: spell.pitch, roll: spell.roll, angle: spell.angle,
    ...(spell.effect !== undefined ? { effect: spell.effect } : {}),
    ...(spell.caster !== undefined ? { caster: spell.caster } : {}),
    ...(meta.owner !== undefined ? { owner: meta.owner } : {}),
    ...(text(meta.name, MEASURE_LIMITS.name) !== undefined ? { name: text(meta.name, MEASURE_LIMITS.name)! } : {}),
    ...(about !== undefined ? { about } : {}),
    ...(isRecord(meta.rules) ? { rules: meta.rules } : {}),
  };
  const look = atlasEffectOf(spell.effect);
  return {
    shape: flat.shape,
    points: flat.points.map((point) => ({ x: point.x, y: point.y })),
    ...(flat.width !== undefined ? { width: flat.width } : {}),
    ...(meta.color !== undefined ? { color: meta.color } : {}),
    ...(meta.hidden === true ? { hidden: true as const } : {}),
    ...(meta.by !== undefined ? { by: meta.by } : {}),
    ...(look !== undefined ? { effect: look } : {}),
    tabletop: extra,
  };
}

/** A measure's `tabletop` field, read: null where it has none or it is not one of this version. Only known keys are kept. */
export function readExtra(measure: Pick<MeasureRecord, 'tabletop'>): TabletopExtra | null {
  const raw = measure.tabletop;
  if (!isRecord(raw) || raw.v !== 1 || (raw.kind !== 'spell' && raw.kind !== 'template')) return null;
  const owner = text(raw.owner, MEASURE_LIMITS.id);
  const shared = { ...(owner !== undefined ? { owner } : {}), ...(raw.temp === true ? { temp: true as const } : {}) };
  if (raw.kind === 'template') return { v: 1, kind: 'template', ...shared };
  const rel = raw.rel;
  if (!(SPELL_SHAPE_NAMES as readonly unknown[]).includes(raw.shape) || (raw.from !== 'self' && raw.from !== 'point') || !isRecord(rel)) return null;
  if (![rel.ax, rel.ay, rel.turn, rel.size, rel.length, raw.h, raw.pitch, raw.roll].every(finite)) return null;
  if ((rel.tx !== undefined || rel.ty !== undefined) && !(finite(rel.tx) && finite(rel.ty))) return null;
  const caster = text(raw.caster, MEASURE_LIMITS.id);
  const name = text(raw.name, MEASURE_LIMITS.name);
  const about = cutAbout(raw.about);
  return {
    v: 1, kind: 'spell', shape: raw.shape as SpellShape, from: raw.from,
    rel: { ax: rel.ax as number, ay: rel.ay as number, turn: rel.turn as number, size: rel.size as number, length: rel.length as number, ...(finite(rel.tx) && finite(rel.ty) ? { tx: rel.tx, ty: rel.ty } : {}) },
    h: raw.h as number, pitch: raw.pitch as number, roll: raw.roll as number,
    ...(finite(raw.angle) ? { angle: raw.angle } : {}),
    ...(typeof raw.effect === 'string' && raw.effect.length <= 40 ? { effect: raw.effect } : {}),
    ...(caster !== undefined ? { caster } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(about !== undefined ? { about } : {}),
    ...(isRecord(raw.rules) ? { rules: raw.rules } : {}),
    ...shared,
  };
}

/** What a measure is: a spell (its `tabletop` field reads as one), a player's template, or an area made in Atlas. */
export function measureKind(measure: MeasureRecord): 'spell' | 'template' | 'area' {
  const extra = readExtra(measure);
  if (extra?.kind === 'template') return 'template';
  return extra?.kind === 'spell' && measureToSpell(measure) !== null ? 'spell' : 'area';
}

/**
 * The spell a measure holds, where its points lie now: null for a measure that holds none, or whose field or points
 * cannot be read as one (its sizes out of range, its points no two places apart).
 */
export function measureToSpell(measure: MeasureRecord): { spell: SpellLike; meta: SpellMeta } | null {
  const extra = readExtra(measure);
  const frame = Array.isArray(measure.points) ? frameOf(measure.points) : null;
  if (!extra || extra.kind !== 'spell' || !extra.rel || !extra.shape || !extra.from || !frame) return null;
  const { rel } = extra;
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  const world = (x: number, y: number): FloorPoint => ({ x: frame.origin.x + frame.span * (x * cos - y * sin), y: frame.origin.y + frame.span * (x * sin + y * cos) });
  const at = world(rel.ax, rel.ay);
  let size = rel.size * frame.span;
  const length = rel.length * frame.span;
  // A line's width is Atlas's to change (its popover): a wall is as thick, a beam half as wide.
  if (measure.shape === 'line' && finite(measure.width) && measure.width > 0) size = extra.shape === 'wall' ? measure.width : extra.shape === 'cylinder' ? measure.width / 2 : size;
  const angle = extra.angle ?? Math.PI / 2;
  if (!(size > 0) || size > MAX_SIZE || !(length >= 0) || length > MAX_SIZE || !(angle > 0) || !(angle < Math.PI)) return null;
  if ((extra.shape === 'wall' || extra.shape === 'cylinder') && !(length > 0)) return null;
  const to = extra.shape === 'wall' ? world(rel.tx ?? 1, rel.ty ?? 0) : undefined;
  const spell: SpellLike = {
    shape: extra.shape, from: extra.shape === 'wall' ? 'point' : extra.from,
    at: { x: at.x, y: at.y, h: extra.h! },
    ...(to ? { to } : {}),
    yaw: yawOf(frame.angle + rel.turn), pitch: extra.pitch!, roll: extra.roll!, size, length, angle,
    ...(extra.caster !== undefined ? { caster: extra.caster } : {}),
    ...(extra.effect !== undefined ? { effect: extra.effect } : {}),
  };
  const meta: SpellMeta = {
    ...(extra.owner !== undefined ? { owner: extra.owner } : {}),
    ...(typeof measure.by === 'string' ? { by: measure.by } : {}),
    ...(typeof measure.color === 'string' ? { color: measure.color } : {}),
    ...(extra.name !== undefined ? { name: extra.name } : {}),
    ...(extra.about !== undefined ? { about: extra.about } : {}),
    ...(extra.rules !== undefined ? { rules: extra.rules } : {}),
    ...(measure.hidden === true ? { hidden: true } : {}),
  };
  return { spell, meta };
}

/** A player's template as a measure of Atlas's own shape between its two points: temporary, and theirs. */
export function templateToMeasure(template: { shape: 'line' | 'circle' | 'square' | 'cone'; start: FloorPoint; end: FloorPoint }, meta: { owner: string; by: string; color: string }): MeasureRecord {
  return {
    shape: template.shape,
    points: [{ x: template.start.x, y: template.start.y }, { x: template.end.x, y: template.end.y }],
    color: meta.color,
    by: meta.by,
    tabletop: { v: 1, kind: 'template', owner: meta.owner, temp: true } satisfies TabletopExtra,
  };
}
