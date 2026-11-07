/**
 * Spells a player casts through a token's eyes on Tabletop's 3D board: a sphere, a cube, a cylinder, a cone or a wall
 * in the board's space (Tabletop's `board/spells.ts` draws them and works out what they hit; the shapes must stay the
 * same). Like the lasting templates (`templates.ts`), the GM keeps each scene's list, gives each its id and its
 * caster's colour, and sends all of it to the scene's players whenever it changes (`map-spells`); players ask to add one,
 * take one of theirs off or clear theirs (`map-spell`). Everything is in map pixels.
 */
import type { ScenePoint } from '../scene/sceneTypes';

export const SPELL_LIMITS = {
  /** Spells one player may have on a scene. */
  perPlayer: 10,
  /** Spells on one scene. */
  perScene: 40,
  /** Spell changes a player may ask for per second. */
  perSecond: 4,
  idLength: 40,
  /** The longest size, map pixels. */
  maxSize: 20000,
} as const;

export const SPELL_SHAPES = ['sphere', 'cube', 'cylinder', 'cone', 'wall'] as const;
export type SpellShape = typeof SPELL_SHAPES[number];
/** D&D's damage types: a spell's look on Tabletop's board (its `spellEffects.ts`); the list must stay the same. */
export const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'explosion', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] as const;
export type DamageType = typeof DAMAGE_TYPES[number];

export interface Spell {
  shape: SpellShape;
  from: 'self' | 'point';
  /** The shape's anchor (`h` its height over the floor), or a wall's first end (`h` its foot). */
  at: { x: number; y: number; h: number };
  /** A wall's other end. */
  to?: ScenePoint;
  yaw: number;
  pitch: number;
  roll: number;
  /** A sphere's or a cylinder's radius, a cube's side, a cone's length, a wall's thickness. */
  size: number;
  /** A cylinder's length, a wall's height; 0 for the rest. */
  length: number;
  /** A cone's opening, radians. */
  angle: number;
  /** The token it was cast from. */
  caster?: string;
  /** Its damage, for its look. */
  effect?: DamageType;
}

export interface MapSpell {
  id: string;
  /** The player who cast it (their session id). */
  owner: string;
  /** `#rrggbb`: its caster's colour. */
  color: string;
  spell: Spell;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e7;
const isPoint = (value: unknown): value is ScenePoint => typeof value === 'object' && value !== null && isNumber((value as ScenePoint).x) && isNumber((value as ScenePoint).y);
const isSize = (value: unknown): value is number => isNumber(value) && value >= 0 && value <= SPELL_LIMITS.maxSize;
const HEX = /^#[0-9a-f]{6}$/i;

export function isSpellId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= SPELL_LIMITS.idLength && /^[\w-]+$/.test(value);
}

/** A spell as a player sends it: a known shape, finite numbers, sizes in range, what each shape needs. */
export function isSpell(value: unknown): value is Spell {
  if (typeof value !== 'object' || value === null) return false;
  const spell = value as Partial<Record<keyof Spell, unknown>>;
  if (typeof spell.shape !== 'string' || !(SPELL_SHAPES as readonly string[]).includes(spell.shape)) return false;
  if (spell.from !== 'self' && spell.from !== 'point') return false;
  if (!isPoint(spell.at) || !isNumber((spell.at as { h?: unknown }).h)) return false;
  if (!isNumber(spell.yaw) || !isNumber(spell.pitch) || !isNumber(spell.roll)) return false;
  if (!isSize(spell.size) || spell.size <= 0 || !isSize(spell.length)) return false;
  if (!isNumber(spell.angle) || spell.angle <= 0 || spell.angle >= Math.PI) return false;
  if (spell.shape === 'wall' && (!isPoint(spell.to) || spell.length <= 0)) return false;
  if (spell.shape !== 'wall' && spell.to !== undefined) return false;
  if (spell.shape === 'cylinder' && spell.length <= 0) return false;
  if (spell.caster !== undefined && (typeof spell.caster !== 'string' || spell.caster.length === 0 || spell.caster.length > 200)) return false;
  if (spell.effect !== undefined && (typeof spell.effect !== 'string' || !(DAMAGE_TYPES as readonly string[]).includes(spell.effect))) return false;
  const known = new Set(['shape', 'from', 'at', 'to', 'yaw', 'pitch', 'roll', 'size', 'length', 'angle', 'caster', 'effect']);
  return Object.keys(spell).every((key) => known.has(key)) && Object.keys(spell.at as object).every((key) => key === 'x' || key === 'y' || key === 'h');
}

/** A copy of a spell with only its own fields (what the GM keeps and sends on). */
export function cleanSpell(spell: Spell): Spell {
  return {
    shape: spell.shape, from: spell.from, at: { x: spell.at.x, y: spell.at.y, h: spell.at.h },
    ...(spell.to ? { to: { x: spell.to.x, y: spell.to.y } } : {}),
    yaw: spell.yaw, pitch: spell.pitch, roll: spell.roll, size: spell.size, length: spell.length, angle: spell.angle,
    ...(spell.caster !== undefined ? { caster: spell.caster } : {}),
    ...(spell.effect !== undefined ? { effect: spell.effect } : {}),
  };
}

export function isMapSpells(value: unknown): value is MapSpell[] {
  return Array.isArray(value) && value.length <= SPELL_LIMITS.perScene && value.every((entry) => typeof entry === 'object' && entry !== null
    && isSpellId((entry as MapSpell).id) && typeof (entry as MapSpell).owner === 'string' && (entry as MapSpell).owner.length <= 128
    && typeof (entry as MapSpell).color === 'string' && HEX.test((entry as MapSpell).color) && isSpell((entry as MapSpell).spell));
}

/** What a player asks: cast one (for the GM's ask `request`), take one of theirs off, clear theirs, or turn down an ask. */
export type SpellChange = { add: Spell; request?: string } | { remove: string } | { clear: true } | { decline: string };

/**
 * A spell the GM asks of a token, as the GM sets it: its shape, where it starts and its sizes (map pixels), with a
 * name. The player only aims it (and, at a point, moves and turns it); the GM takes the cast as asked. Shaped so a
 * prepared spell (one kept with its sizes) can fill it later.
 */
export interface SpellAsk {
  /** What it is called, e.g. "Fireball". */
  name?: string;
  shape: SpellShape;
  /** Where it starts; a wall is always at points. */
  from: 'self' | 'point';
  /** As `Spell.size`. */
  size: number;
  /** As `Spell.length`: a cylinder's length, a wall's height; 0 for the rest. */
  length: number;
  /** A cone's opening, radians; the scene's own without it. */
  angle?: number;
  /** A wall's longest run, map pixels. */
  longest?: number;
}

/** An ask sent to a token's players: its id and the token it is asked of. */
export interface SpellRequest {
  id: string;
  tokenId: string;
  ask: SpellAsk;
}

export const SPELL_NAME_LENGTH = 60;
/** Asks one player may have waiting at once. */
export const SPELL_ASKS_PER_PLAYER = 8;

export function isSpellAsk(value: unknown): value is SpellAsk {
  if (typeof value !== 'object' || value === null) return false;
  const ask = value as Partial<Record<keyof SpellAsk, unknown>>;
  if (typeof ask.shape !== 'string' || !(SPELL_SHAPES as readonly string[]).includes(ask.shape)) return false;
  if (ask.from !== 'self' && ask.from !== 'point') return false;
  if (!isSize(ask.size) || ask.size <= 0 || !isSize(ask.length)) return false;
  if ((ask.shape === 'wall' || ask.shape === 'cylinder') && ask.length <= 0) return false;
  if (ask.angle !== undefined && (!isNumber(ask.angle) || ask.angle <= 0 || ask.angle >= Math.PI)) return false;
  if (ask.longest !== undefined && (!isSize(ask.longest) || ask.longest <= 0)) return false;
  if (ask.name !== undefined && (typeof ask.name !== 'string' || ask.name.length > SPELL_NAME_LENGTH)) return false;
  const known = new Set(['name', 'shape', 'from', 'size', 'length', 'angle', 'longest']);
  return Object.keys(ask).every((key) => known.has(key));
}

export function isSpellRequests(value: unknown): value is SpellRequest[] {
  return Array.isArray(value) && value.length <= SPELL_ASKS_PER_PLAYER && value.every((entry) => typeof entry === 'object' && entry !== null
    && isSpellId((entry as SpellRequest).id) && typeof (entry as SpellRequest).tokenId === 'string' && (entry as SpellRequest).tokenId.length > 0
    && (entry as SpellRequest).tokenId.length <= 200 && isSpellAsk((entry as SpellRequest).ask));
}

/** A copy of an ask with only its own fields. */
export function cleanAsk(ask: SpellAsk): SpellAsk {
  return {
    ...(ask.name !== undefined && ask.name.trim() !== '' ? { name: ask.name.trim() } : {}),
    shape: ask.shape, from: ask.shape === 'wall' ? 'point' : ask.from, size: ask.size, length: ask.shape === 'wall' || ask.shape === 'cylinder' ? ask.length : 0,
    ...(ask.angle !== undefined ? { angle: ask.angle } : {}),
    ...(ask.shape === 'wall' && ask.longest !== undefined ? { longest: ask.longest } : {}),
  };
}

/**
 * A spell cast for an ask, made to be what the GM asked: its shape, start and sizes the ask's (the cone's opening too,
 * when the ask has one), a wall no longer than its longest run. Where it is and how it is turned stay the player's.
 */
export function askedSpell(spell: Spell, ask: SpellAsk): Spell {
  const made: Spell = { ...cleanSpell(spell), shape: ask.shape, from: ask.shape === 'wall' ? 'point' : ask.from, size: ask.size, length: ask.shape === 'wall' || ask.shape === 'cylinder' ? ask.length : 0 };
  if (ask.angle !== undefined) made.angle = ask.angle;
  if (ask.shape !== 'wall') { delete made.to; return made; }
  const to = spell.to ?? { x: spell.at.x + 1e-3, y: spell.at.y };
  const run = Math.hypot(to.x - spell.at.x, to.y - spell.at.y);
  const longest = ask.longest ?? Infinity;
  made.to = run <= longest || run === 0 ? { x: to.x, y: to.y } : { x: spell.at.x + ((to.x - spell.at.x) * longest) / run, y: spell.at.y + ((to.y - spell.at.y) * longest) / run };
  return made;
}
