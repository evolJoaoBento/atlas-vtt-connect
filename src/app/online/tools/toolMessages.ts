/**
 * The player tools' messages: dice rolls, the shared dice log and lasers. Their types, limits
 * and checks, shared with the web player page, so this file imports only shared modules.
 */
import { diceFormula, isDieType, parseFormula, type DiceCrit, type DiceRollResult, type DiceSelection } from '@atlas-vtt/shared/rules';
import { SCENE_RANGES } from '../scene/sceneLimits';
import type { ScenePoint } from '../scene/sceneTypes';
import { isSceneId } from '../scene/sceneValidation';
import { dieTagOf } from './diceTags';
import { isSheetRollRef, type SheetRollRef } from './sheets';

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
 * `color` (`#rrggbb`) and `colorName` tag a die as Atlas 1.16 does (`diceTags.ts`); a page without them ignores them.
 */
export interface LoggedDie {
  die: string;
  value: number;
  negative?: true;
  exploded?: true;
  color?: string;
  colorName?: string;
  /** Counted for nothing: a die advantage or a keep mark dropped (Atlas 0.8's `RolledDie.dropped`); an older page ignores it. */
  dropped?: true;
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
  /**
   * The roller's scene (its tab name), on player rolls only while more than one scene is in use; plain text,
   * trimmed, at most 64 characters (`cleanSceneLabel`). A label that is not well-formed is dropped, never the roll.
   */
  scene?: string;
  /**
   * The ability a stat block roll is named after ("Mace", "Wisdom save"), as Atlas's toast labels it. A player's roll
   * also carries it in its name ("Ana: Mace") for older pages; a page that shows it takes it off the name.
   */
  ability?: string;
  /** Rolled with advantage or disadvantage, as Atlas's toast tags it. */
  advantage?: 'advantage' | 'disadvantage';
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
  /** The laser's size as the sender picked it (Atlas's 8 to 100); without it, Atlas's default. */
  size?: number;
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

/**
 * The formula for a player's roll, or null when `dice.roll` would refuse it (Atlas 1.16 reads at most 100 dice, 10 terms,
 * 64 characters, and a modifier of at most four digits). A roll that passes `isDiceSelection` and `isDiceModifier` always
 * fits (at most 20 dice, 8 terms, `d100` and `-1000`); this is the check that keeps it so if those limits ever grow.
 */
export function playerRollFormula(dice: DiceSelection, modifier: number): string | null {
  const formula = diceFormula(dice, modifier);
  return parseFormula(formula).ok ? formula : null;
}

/** The sides of each die a player may throw physically; a d100 reads as one combined value, 1 to 100 (00 and 0 make 100). */
const PHYSICAL_SIDES: Readonly<Record<string, number>> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 };

/** One die of a roll the player threw on Tabletop's board, as Atlas's `RolledDie` without `max`. */
export interface PhysicalDie {
  die: 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';
  /** 1 up to the die's sides; never 0. */
  value: number;
  exploded?: true;
  negative?: true;
  dropped?: true;
  color?: string;
  colorName?: string;
}

/** A finished physical throw, as the player sends it (`dice-result`) and Tabletop's board hands it over. */
export interface PhysicalRoll {
  rolls: PhysicalDie[];
  modifier: number;
  label?: string;
  sheet?: { tokenId: string; roll: SheetRollRef };
}

/** How a collection rolls dice, as the GM offers it with `board-offer` (Atlas's `DiceRules`). */
export interface OfferedDiceRules {
  defaultRoll: string;
  crit: 'natural' | 'roll-under' | 'doubles' | 'high-total' | 'none';
  explode?: { dice: 'default' | 'all'; repeats: boolean; highFaces: number; lowFaces: number };
}

/** A physical roll's modifier lies within ±999. */
export const PHYSICAL_MODIFIER = 999;
const PHYSICAL_LABEL = 120;
const CRIT_RULES: readonly unknown[] = ['natural', 'roll-under', 'doubles', 'high-total', 'none'];

function isPhysicalDie(value: unknown): value is PhysicalDie {
  if (!isFields(value) || typeof value.die !== 'string' || !Object.hasOwn(PHYSICAL_SIDES, value.die)) return false;
  return Number.isSafeInteger(value.value) && (value.value as number) >= 1 && (value.value as number) <= (PHYSICAL_SIDES[value.die] ?? 0)
    && isFlag(value.exploded) && isFlag(value.negative) && isFlag(value.dropped)
    && (value.color === undefined || isLaserColor(value.color))
    && (value.colorName === undefined || isText(value.colorName, 0, DICE_LIMITS.nameLength));
}

/** 1 to 20 dice, each read (1 up to its sides), a modifier within ±999, a label of at most 120 characters, and a sheet roll if any. */
export function isPhysicalRoll(value: unknown): value is PhysicalRoll {
  return isFields(value) && Array.isArray(value.rolls) && value.rolls.length >= 1 && value.rolls.length <= DICE_LIMITS.dicePerRoll
    && value.rolls.every((die) => isPhysicalDie(die))
    && Number.isSafeInteger(value.modifier) && Math.abs(value.modifier as number) <= PHYSICAL_MODIFIER
    && (value.label === undefined || isText(value.label, 0, PHYSICAL_LABEL))
    && (value.sheet === undefined || (isFields(value.sheet) && isSceneId(value.sheet.tokenId) && isSheetRollRef(value.sheet.roll)));
}

const isWhole = (value: unknown, max: number): boolean => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;

export function isOfferedDiceRules(value: unknown): value is OfferedDiceRules {
  if (!isFields(value) || !isText(value.defaultRoll, 1, 32) || !CRIT_RULES.includes(value.crit)) return false;
  const rule = value.explode;
  if (rule === undefined) return true;
  return isFields(rule) && (rule.dice === 'default' || rule.dice === 'all') && typeof rule.repeats === 'boolean'
    && isWhole(rule.highFaces, 100) && isWhole(rule.lowFaces, 100);
}

/** Absent, or exactly `true`. */
const isFlag = (value: unknown): boolean => value === undefined || value === true;

function isLoggedDie(value: unknown): value is LoggedDie {
  if (!isFields(value) || typeof value.die !== 'string') return false;
  const sides = DIE.exec(value.die)?.[1];
  return sides !== undefined && Number.isSafeInteger(value.value) && (value.value as number) >= 1 && (value.value as number) <= Number(sides)
    && isFlag(value.negative) && isFlag(value.exploded) && isFlag(value.dropped);
}

export function isDiceLogEntry(value: unknown): value is DiceLogEntry {
  return isFields(value) && isSceneId(value.id) && isText(value.name, 1, DICE_LIMITS.nameLength)
    && isText(value.formula, 0, DICE_LIMITS.formulaLength)
    && Array.isArray(value.dice) && value.dice.length <= DICE_LIMITS.entryDice && value.dice.every((die) => isLoggedDie(die))
    && (value.unlisted === undefined || (Number.isSafeInteger(value.unlisted) && (value.unlisted as number) > 0))
    && (value.crit === undefined || value.crit === 'high' || value.crit === 'low')
    && isFlag(value.mine)
    && (value.ability === undefined || isText(value.ability, 1, DICE_LIMITS.nameLength))
    && (value.advantage === undefined || value.advantage === 'advantage' || value.advantage === 'disadvantage')
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
  const all = result.rolls.map((rolled): LoggedDie => {
    const { die, value, negative, exploded } = rolled;
    const dropped = (rolled as { dropped?: unknown }).dropped === true;
    return { die, value, ...(negative && { negative }), ...(exploded && { exploded }), ...(dropped && { dropped: true as const }), ...dieTagOf(rolled) };
  });
  const dice = all.every((die) => isLoggedDie(die)) ? all.slice(0, DICE_LIMITS.entryDice) : [];
  // A roll made elsewhere (physical dice) may come with dice its own list leaves out already.
  const { unlistedDice = 0 } = result;
  const unlisted = all.length - dice.length + (Number.isSafeInteger(unlistedDice) && unlistedDice > 0 ? unlistedDice : 0);
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
    ...abilityOf(result),
  };
  return isDiceLogEntry(entry) ? entry : null;
}

/** The ability and the side a roll names (Atlas 0.8's `source.abilityName` and `advantage`), as far as they are well-formed. */
function abilityOf(result: DiceRollResult): Pick<DiceLogEntry, 'ability' | 'advantage'> {
  const ability = typeof result.source?.abilityName === 'string' ? result.source.abilityName.trim().slice(0, DICE_LIMITS.nameLength) : '';
  const side = (result as { advantage?: unknown }).advantage;
  return {
    ...(ability ? { ability } : {}),
    ...(side === 'advantage' || side === 'disadvantage' ? { advantage: side } : {}),
  };
}

export const SCENE_LABEL_MAX = 64;
/** Controls (newlines and tabs too) and invisible formatting characters (bidi overrides, zero width). */
const FORBIDDEN_IN_LABEL = /[\p{Cc}\p{Cf}]/u;

/** The scene label trimmed when it is plain text of 1 to 64 code points; undefined otherwise. */
export function cleanSceneLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.trim();
  if (label.length === 0 || label.length > SCENE_LABEL_MAX * 2 || FORBIDDEN_IN_LABEL.test(label)) return undefined;
  return Array.from(label).length <= SCENE_LABEL_MAX ? label : undefined;
}

/**
 * Drops what is not well-formed in received entries, in place (the entries are fresh from JSON): a die's tag, and the
 * entry's scene label. `isDiceLogEntry` never looks at either, so a bad one is dropped and never refuses the roll.
 */
export function cleanLoggedEntries(entries: readonly DiceLogEntry[]): void {
  for (const entry of entries) {
    if ('scene' in entry) {
      const label = cleanSceneLabel(entry.scene);
      if (label === undefined) delete entry.scene;
      else entry.scene = label;
    }
    entry.dice.forEach((die, index) => {
      if (!('color' in die) && !('colorName' in die)) return;
      const { die: kind, value, negative, exploded } = die;
      entry.dice[index] = { die: kind, value, ...(negative && { negative }), ...(exploded && { exploded }), ...dieTagOf(die) };
    });
  }
}

/** The entry as `playerId` gets it: marked `mine` when they rolled it. */
export function entryFor(entry: DiceLogEntry, rolledBy: string | null, playerId: string): DiceLogEntry {
  return rolledBy === playerId ? { ...entry, mine: true } : entry;
}
