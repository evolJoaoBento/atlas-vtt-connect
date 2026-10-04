/**
 * The player tools' messages: dice rolls, the shared dice log and lasers. Their types, limits
 * and checks, shared with the web player page, so this file imports only shared modules.
 */
import { isDieType, type DiceCrit, type DiceRollResult, type DiceSelection } from '@atlas-vtt/shared/rules';
import { SCENE_RANGES } from '../scene/sceneLimits';
import type { ScenePoint } from '../scene/sceneTypes';
import { isSceneId } from '../scene/sceneValidation';

export const DICE_LIMITS = {
  /** Dice in one player roll. */
  dicePerRoll: 20,
  /** A player roll's modifier lies within ±1000. */
  modifier: 1000,
  rollsPerSecond: 2,
  /** Entries a player gets on admission. */
  logEntries: 50,
  /** Dice listed in one entry; a larger roll lists its first 100, says how many more it had (`unlisted`), and its total still counts them all. */
  entryDice: 100,
  nameLength: 80,
  formulaLength: 200,
} as const;

/** `maxGapMs`: the longest gap a point's `dt` may state (a laser held still is kept alive, not timed). */
export const LASER_LIMITS = { points: 64, perSecond: 30, maxGapMs: 2000 } as const;

/** The name of a roll that is neither an online player's nor that of a visible token on the live presented scene. */
export const GM_ROLLER_NAME = 'GM';

/**
 * One die of a logged roll, as Atlas's `RolledDie` without `max` (the die's sides): `negative` when it
 * subtracts (`2d6-1d4`, an explosion downwards), `exploded` when an explosion of the die before it rolled it.
 */
export interface LoggedDie {
  die: string;
  value: number;
  negative?: true;
  exploded?: true;
}

/** One roll in the shared dice log. */
export interface DiceLogEntry {
  id: string;
  /** An online player's name ("GM (player)" for one called GM), a visible token's on the live presented scene, or "GM". */
  name: string;
  formula: string;
  /** In the order they were rolled: an exploded die right after the die it was rolled for. */
  dice: LoggedDie[];
  /** Dice the roll had beyond those listed (`DICE_LIMITS.entryDice`); absent when every die is listed. */
  unlisted?: number;
  modifier: number;
  total: number;
  /** The collection's critical rule decided it when rolled; absent for none. */
  crit?: Exclude<DiceCrit, null>;
  /** Sent only to the player who rolled it: their own roll, which their page throws as dice. */
  mine?: true;
  /** When it was rolled: milliseconds since 1970 on the GM's clock. */
  at: number;
}

/** Someone's laser as a player receives it: new points of it, and whether it was let go. */
export interface PlayerLaser {
  from: string;
  sceneId: string;
  points: ScenePoint[];
  lifted: boolean;
  /** Milliseconds from each point to the one before it in the stroke (0 for its first), when the sender timed them. */
  dt?: number[];
  /** The laser's colour, `#rrggbb`: the sender's pick, or the one the GM gave it. */
  color?: string;
}

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max;
/** `d` and 1 to 9999 sides. */
const DIE = /^d([1-9]\d{0,3})$/;

/** 1 to 20 dice of the tray's kinds, each count a whole number. */
export function isDiceSelection(value: unknown): value is DiceSelection {
  if (!isFields(value)) return false;
  let total = 0;
  for (const [die, count] of Object.entries(value)) {
    if (!isDieType(die) || !Number.isSafeInteger(count) || (count as number) < 0) return false;
    total += count as number;
  }
  return total >= 1 && total <= DICE_LIMITS.dicePerRoll;
}

export function isDiceModifier(value: unknown): value is number {
  return Number.isSafeInteger(value) && Math.abs(value as number) <= DICE_LIMITS.modifier;
}

/** Absent, or exactly `true`. */
const isFlag = (value: unknown): boolean => value === undefined || value === true;

function isLoggedDie(value: unknown): value is LoggedDie {
  if (!isFields(value) || typeof value.die !== 'string') return false;
  const sides = DIE.exec(value.die)?.[1];
  return sides !== undefined && Number.isSafeInteger(value.value) && (value.value as number) >= 1 && (value.value as number) <= Number(sides)
    && isFlag(value.negative) && isFlag(value.exploded);
}

export function isDiceLogEntry(value: unknown): value is DiceLogEntry {
  return isFields(value) && isSceneId(value.id) && isText(value.name, 1, DICE_LIMITS.nameLength)
    && isText(value.formula, 0, DICE_LIMITS.formulaLength)
    && Array.isArray(value.dice) && value.dice.length <= DICE_LIMITS.entryDice && value.dice.every((die) => isLoggedDie(die))
    && (value.unlisted === undefined || (Number.isSafeInteger(value.unlisted) && (value.unlisted as number) > 0))
    && (value.crit === undefined || value.crit === 'high' || value.crit === 'low')
    && isFlag(value.mine)
    && isFiniteNumber(value.modifier) && isFiniteNumber(value.total) && isFiniteNumber(value.at);
}

export function isDiceLogEntries(value: unknown): value is DiceLogEntry[] {
  return Array.isArray(value) && value.length <= DICE_LIMITS.logEntries && value.every((entry) => isDiceLogEntry(entry));
}

/** At most 64 points, each within the scene's coordinate range. */
export function isLaserPoints(value: unknown): value is ScenePoint[] {
  const [min, max] = SCENE_RANGES.coordinate;
  const inRange = (number: unknown): boolean => isFiniteNumber(number) && number >= min && number <= max;
  return Array.isArray(value) && value.length <= LASER_LIMITS.points
    && value.every((point) => isFields(point) && inRange(point.x) && inRange(point.y));
}

/** Absent, or one gap in milliseconds (0 to `LASER_LIMITS.maxGapMs`) per point. */
export function isLaserTimes(value: unknown, points: readonly unknown[]): value is number[] | undefined {
  if (value === undefined) return true;
  return Array.isArray(value) && value.length === points.length
    && value.every((gap) => isFiniteNumber(gap) && gap >= 0 && gap <= LASER_LIMITS.maxGapMs);
}

const LASER_COLOR = /^#[0-9a-f]{6}$/i;

/** A `#rrggbb` colour. */
export function isLaserColor(value: unknown): value is string {
  return typeof value === 'string' && LASER_COLOR.test(value);
}

/**
 * A roll as the dice log shows it, under `name`, clipped to the limits; null when players would refuse it anyway.
 * Dice are clipped, never filtered: an exploded die must stay right after the die it was rolled for. A roll
 * holding a die players cannot take (more than 9999 sides) lists none of its dice, and counts them all unlisted.
 */
export function diceLogEntry(result: DiceRollResult, name: string): DiceLogEntry | null {
  const all = result.rolls.map(({ die, value, negative, exploded }): LoggedDie => ({
    die, value, ...(negative && { negative }), ...(exploded && { exploded }),
  }));
  const dice = all.every((die) => isLoggedDie(die)) ? all.slice(0, DICE_LIMITS.entryDice) : [];
  const unlisted = all.length - dice.length;
  const entry: DiceLogEntry = {
    id: result.id,
    name: name.slice(0, DICE_LIMITS.nameLength),
    formula: result.formula.slice(0, DICE_LIMITS.formulaLength),
    dice,
    ...(unlisted > 0 && { unlisted }),
    modifier: result.modifiers,
    total: result.total,
    ...(result.crit && { crit: result.crit }),
    at: result.timestamp,
  };
  return isDiceLogEntry(entry) ? entry : null;
}

/** The entry as `playerId` gets it: marked `mine` when they rolled it. */
export function entryFor(entry: DiceLogEntry, rolledBy: string | null, playerId: string): DiceLogEntry {
  return rolledBy === playerId ? { ...entry, mine: true } : entry;
}
