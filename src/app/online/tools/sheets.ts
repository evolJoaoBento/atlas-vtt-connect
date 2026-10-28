/**
 * A player's sheets: the tokens they control with their exact numbers and stat block, sent to that player alone
 * (`token-sheets`), and the rolls they ask for from them (`sheet-roll`). Shared by the GM, the join page and Obsidian.
 *
 * A stat block reaches a player only as `PlayerSheet`: a whitelist of a creature's fields (`buildSheet`), every text
 * capped, never a path, an image or a field this file does not name. A roll is asked for by where it is on the sheet
 * (`SheetRollRef`), never by a formula: the GM builds the sheet again from its own stat block and rolls what it finds
 * there (`sheetRollFormula`), so a player can roll only what their sheet offers.
 */

import { CARD_LIMITS, isSheetCard, type SheetCard } from './sheetCards';

export const SHEET_LIMITS = {
  /** Tokens per player in one message. */
  tokens: 16,
  name: 120,
  /** A short field: AC, HP, speed, a size and type line. */
  short: 200,
  /** One line of the sheet: senses, languages, immunities. */
  line: 500,
  lines: 16,
  /** One trait's or action's description. */
  desc: 2000,
  sections: 8,
  items: 40,
  bonuses: 24,
  resources: 6,
  /** Rolls a player may ask for per second. */
  rollsPerSecond: 2,
  /** The text of one roll in a trait's text, as the player clicked it. */
  rollText: 200,
} as const;

export const ABILITY_NAMES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;

export interface SheetResource {
  name: string;
  current: number;
  max: number;
  /** `#rrggbb`. */
  color?: string;
}

/** A named bonus a player can roll a d20 with: a save or a skill. */
export interface SheetBonus {
  label: string;
  bonus: number;
}

export interface SheetItem {
  name: string;
  desc: string;
  /** Set by a template block with `rollable`: its plain numbers roll, as Atlas rolls them (`rollableBonus`, below). */
  rollable?: true;
}

export interface SheetSection {
  title: string;
  items: SheetItem[];
}

export interface SheetLine {
  label: string;
  text: string;
}

export interface PlayerSheet {
  name: string;
  /** "Medium humanoid (elf), neutral good". */
  subtitle: string | null;
  ac: string | null;
  hp: string | null;
  speed: string | null;
  /** The six ability scores, STR to CHA; null when the stat block has none. */
  stats: number[] | null;
  saves: SheetBonus[];
  skills: SheetBonus[];
  lines: SheetLine[];
  sections: SheetSection[];
}

export interface TokenSheet {
  tokenId: string;
  /** The token's name as the GM's map shows it. */
  name: string | null;
  /** Every resource of the collection the token has a value for, with its exact numbers. */
  resources: SheetResource[];
  /** The linked stat block; null when the token links none or it cannot be read. */
  sheet: PlayerSheet | null;
  /** The stat block as Atlas draws it (`sheetCards.ts`), shown in place of `sheet` where a page can; absent where Atlas draws none. */
  card?: SheetCard;
}

/** A roll with advantage or disadvantage: Atlas's dice set rule for that side decides what it does (`diceAdvantage`). */
export const ADVANTAGE_SIDES = ['advantage', 'disadvantage'] as const;
export type AdvantageSide = typeof ADVANTAGE_SIDES[number];

/**
 * Where on a sheet a roll is: an ability check, a save, a skill, or the n-th roll in a trait's or action's text, whose
 * `text` is what the player clicked (the GM rolls only when its own copy has that text there), and the side it is
 * rolled with, if any.
 */
export type SheetRollRef = (
  | { kind: 'check'; index: number }
  | { kind: 'save'; index: number }
  | { kind: 'skill'; index: number }
  | { kind: 'text'; section: number; item: number; index: number; text?: string }
  | { kind: 'card'; index: number; text: string }
) & { side?: AdvantageSide };

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const HEX = /^#[0-9a-f]{6}$/i;

/** Plain text of at most `max` characters, or null: numbers become text, markup-looking brackets stay text. */
export function text(value: unknown, max: number): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max);
  if (typeof value !== 'string') return null;
  // Control characters out (tabs and line breaks become spaces with the rest of the whitespace), runs to one space.
  const kept = [...value].filter((char) => {
    const code = char.charCodeAt(0);
    return (code >= 32 && code !== 127) || char === '\n' || char === '\t' || char === '\r';
  }).join('');
  const cleaned = kept.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export const modifierOf = (score: number): number => Math.floor((score - 10) / 2);

const signed = (value: number): string => (value >= 0 ? `+${value}` : String(value));

/** A save or skill list as Fantasy Statblocks keeps it: `[{ dexterity: 5 }]`, `[{ name, desc }]` or `{ perception: 4 }`. */
function bonuses(value: unknown): SheetBonus[] {
  const entries: Array<[unknown, unknown]> = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isObject(item)) continue;
      if ('name' in item) entries.push([item.name, item.desc ?? item.value ?? item.bonus]);
      else entries.push(...Object.entries(item));
    }
  } else if (isObject(value)) entries.push(...Object.entries(value));
  const found: SheetBonus[] = [];
  for (const [label, raw] of entries) {
    const name = text(label, 40);
    const bonus = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw.replace(/\s/g, ''), 10) : NaN;
    if (!name || !Number.isInteger(bonus) || Math.abs(bonus) > 99) continue;
    found.push({ label: name.charAt(0).toUpperCase() + name.slice(1), bonus });
    if (found.length >= SHEET_LIMITS.bonuses) break;
  }
  return found;
}

function items(value: unknown): SheetItem[] {
  if (!Array.isArray(value)) return [];
  const found: SheetItem[] = [];
  for (const entry of value) {
    let name: string | null = null;
    let desc: string | null = null;
    if (Array.isArray(entry)) {
      name = text(entry[0], SHEET_LIMITS.name);
      desc = text(entry[1], SHEET_LIMITS.desc);
    } else if (isObject(entry)) {
      name = text(entry.name, SHEET_LIMITS.name);
      desc = text(entry.desc ?? entry.description ?? entry.text, SHEET_LIMITS.desc);
    } else {
      desc = text(entry, SHEET_LIMITS.desc);
    }
    if (!name && !desc) continue;
    found.push({ name: name ?? '', desc: desc ?? '' });
    if (found.length >= SHEET_LIMITS.items) break;
  }
  return found;
}

/** A list field written out: an array of words or a string. */
function listText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const words = (value as unknown[]).map((item): unknown => (isObject(item) ? item.name : item))
      .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
    return text(words.join(', '), SHEET_LIMITS.line);
  }
  return text(value, SHEET_LIMITS.line);
}

const SECTIONS: ReadonlyArray<[string, string]> = [
  ['traits', 'Traits'], ['spells', 'Spellcasting'], ['actions', 'Actions'], ['bonus_actions', 'Bonus actions'],
  ['reactions', 'Reactions'], ['legendary_actions', 'Legendary actions'], ['mythic_actions', 'Mythic actions'], ['lair_actions', 'Lair actions'],
];
const LINES: ReadonlyArray<[string, string]> = [
  ['damage_vulnerabilities', 'Vulnerabilities'], ['damage_resistances', 'Resistances'], ['damage_immunities', 'Immunities'],
  ['condition_immunities', 'Condition immunities'], ['senses', 'Senses'], ['languages', 'Languages'], ['cr', 'Challenge'],
];

/** The player's view of a creature as Fantasy Statblocks gives it (5e keys); null when it has no name. */
export function buildSheet(creature: unknown, fallbackName: string | null = null): PlayerSheet | null {
  if (!isObject(creature)) return null;
  const name = text(creature.name, SHEET_LIMITS.name) ?? fallbackName;
  if (!name) return null;
  const type = [text(creature.size, 40), text(creature.type, 60), creature.subtype ? `(${text(creature.subtype, 60) ?? ''})` : null].filter(Boolean).join(' ');
  const subtitle = text([type, text(creature.alignment, 60)].filter(Boolean).join(', '), SHEET_LIMITS.short);
  const stats = Array.isArray(creature.stats) && creature.stats.length >= 6
    && creature.stats.slice(0, 6).every((score) => typeof score === 'number' && Number.isFinite(score) && Math.abs(score) < 1000)
    ? (creature.stats.slice(0, 6) as number[]).map((score) => Math.round(score))
    : null;
  const hp = text([text(creature.hp, 40), creature.hit_dice ? `(${text(creature.hit_dice, 60) ?? ''})` : null].filter(Boolean).join(' '), SHEET_LIMITS.short);
  const lines: SheetLine[] = [];
  for (const [key, label] of LINES) {
    const value = listText(creature[key]);
    if (value) lines.push({ label, text: value });
  }
  const sections: SheetSection[] = [];
  for (const [key, title] of SECTIONS) {
    const found = items(creature[key]);
    if (found.length > 0) sections.push({ title, items: found });
    if (sections.length >= SHEET_LIMITS.sections) break;
  }
  return {
    name,
    subtitle,
    ac: text(creature.ac, SHEET_LIMITS.short),
    hp,
    speed: text(creature.speed, SHEET_LIMITS.short),
    stats,
    saves: bonuses(creature.saves),
    skills: bonuses(creature.skillsaves ?? creature.skills),
    lines: lines.slice(0, SHEET_LIMITS.lines),
    sections,
  };
}

/** One piece of a trait's text: plain, or a roll a player can click (its index among the item's rolls). */
export type TextPart = { text: string } | { text: string; roll: number; formula: string };

/**
 * Atlas's dice notation in a stat block's text (`statblockDiceLinks.ts`), so players can roll what Atlas's own stat
 * block would let them. One dice term: `2d8`, `d20`, exploding (`1d6!i`, `1d6!3`, `1d6!!`) and keep marks (`4d6kh3`);
 * a single `!` ends a sentence far more often than it explodes a die.
 */
const DIE = String.raw`\d*d\d+(?:!!?(?:\d+|i(?![a-z]))|!!)?(?:k[hl]\d*(?![a-z]))?`;
/** A further signed term: a die or a constant after `+`, `-`, a minus sign or an en dash, or after "+ -" ("3d6 + -1"). */
const NEXT_TERM = String.raw`\s*(?:\+\s*-|[+\-−–])\s*(?:${DIE}|\d+)`;
/**
 * Dice expressions (`2d8+3`, `2d6 - 1d4`) and bare bonuses (`+4`, `−1`, `ATK: +4`). Neither starts inside a word or a
 * number; a bare sign must sit on its digits and not open a dice term, so the dash in "Very Close - 1d12+2" is no roll.
 */
const DICE_PATTERN = new RegExp(String.raw`((?<!\w)${DIE}(?:${NEXT_TERM})*|(?:ATK|Attack)\s*:\s*[+-]\d+|(?<!\w)[+\-−]\d+(?!\s*d\d))`, 'gi');

/**
 * The formula Atlas rolls for matched text (`toRollFormula`). A bare bonus stays bare: Atlas adds it to the dice set's
 * default roll, so "+5 to hit" rolls the collection's own die.
 */
export function toRollFormula(text: string): string {
  return text.replace(/\s+/g, '').replace(/^(?:ATK|Attack):/i, '').replace(/[−–]/g, '-').replace(/\+-/g, '-');
}

/** A number on its own, signed or not; a template block with `rollable` rolls it. */
const PLAIN_NUMBER = new RegExp(String.raw`(?<![\w.+\-−–])[+\-−–]?\d{1,4}(?![\w.]|\s*d\d)`, 'g');
/** Atlas's rule for a rollable number: `14` and `+14` add 14 to the dice set's default roll, `-2` and `−2` take 2 off, and `0` is `+0`. */
function rollableBonus(shown: string): string {
  const number = Number(shown.replace(/^[+\-−–]/, ''));
  return /^[−–-]/.test(shown) && number !== 0 ? `-${number}` : `+${number}`;
}

/**
 * A trait's text cut into plain pieces and the rolls in it, in order; the same on the GM's side and the player's. In a
 * `rollable` item (a template block's `rollable` setting) a number on its own is a roll too, but only where the text
 * holds no dice or bonus of its own, as Atlas's `rollable` stat leaves a cell that already has one alone.
 */
export function textParts(desc: string, rollable = false): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  let index = 0;
  const own = [...desc.matchAll(DICE_PATTERN)];
  const matches = own.length > 0 || !rollable
    ? own.map((match) => ({ at: match.index ?? 0, text: match[0], formula: toRollFormula(match[0]) }))
    : [...desc.matchAll(PLAIN_NUMBER)].map((match) => ({ at: match.index ?? 0, text: match[0], formula: rollableBonus(match[0]) }));
  for (const match of matches) {
    if (match.at > last) parts.push({ text: desc.slice(last, match.at) });
    parts.push({ text: match.text, roll: index, formula: match.formula });
    index += 1;
    last = match.at + match.text.length;
  }
  if (last < desc.length) parts.push({ text: desc.slice(last) });
  return parts;
}

/** The formula a roll on `sheet` stands for; null when the sheet has no such roll. */
export function sheetRollFormula(sheet: PlayerSheet, ref: SheetRollRef): string | null {
  switch (ref.kind) {
    // A bonus alone, as Atlas's stat block links "(+3)" and "Dex +5": Atlas adds it to the dice set's default roll.
    case 'check': {
      const score = sheet.stats?.[ref.index];
      return score === undefined ? null : signed(modifierOf(score));
    }
    case 'save': {
      const bonus = sheet.saves[ref.index];
      return bonus ? signed(bonus.bonus) : null;
    }
    case 'skill': {
      const bonus = sheet.skills[ref.index];
      return bonus ? signed(bonus.bonus) : null;
    }
    case 'text': {
      const item = sheet.sections[ref.section]?.items[ref.item];
      if (!item) return null;
      const part = textParts(item.desc, item.rollable).find((candidate) => 'roll' in candidate && candidate.roll === ref.index);
      // Never a roll other than the one clicked: a sheet that changed, or a page that cuts the text another way (an
      // older version, which sends no text), finds other text there, and nothing is rolled.
      return part && 'formula' in part && part.text === ref.text ? part.formula : null;
    }
    // A card's rolls are the card's (`cardRollFormula`).
    case 'card': return null;
  }
}

/**
 * What the number a rollable item rolls is called, as Atlas names a rolled cell: the label before it in the same value
 * ("Severe" in "Major 7 | Severe 14"); the item's own name where none stands there.
 */
export function rollableName(item: SheetItem, roll: number): string {
  if (!item.rollable) return item.name;
  // The parts together are the text, so what stands before the roll is every part ahead of it.
  let before = '';
  for (const part of textParts(item.desc, true)) {
    if ('roll' in part && part.roll === roll) break;
    before += part.text;
  }
  const label = before.split(/[|,;]/).pop()?.replace(/[:\s]+$/, '').trim() ?? '';
  return label || item.name;
}

/** What a roll is called in the log: "Anna: Dagger", "Anna: DEX save". */
export function sheetRollLabel(sheet: PlayerSheet, ref: SheetRollRef): string {
  switch (ref.kind) {
    case 'check': return `${ABILITY_NAMES[ref.index] ?? 'Check'} check`;
    case 'save': return `${sheet.saves[ref.index]?.label ?? 'Save'} save`;
    case 'skill': return sheet.skills[ref.index]?.label ?? 'Skill';
    case 'text': {
      const item = sheet.sections[ref.section]?.items[ref.item];
      return (item && rollableName(item, ref.index)) || 'Roll';
    }
    case 'card': return 'Roll';
  }
}

// ── Validation (both sides check what they receive) ─────────────────────

const isInt = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const isTextOrNull = (value: unknown, max: number): boolean => value === null || isText(value, max);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function isSheetRollRef(value: unknown): value is SheetRollRef {
  if (!isObject(value)) return false;
  if (value.side !== undefined && !(ADVANTAGE_SIDES as readonly unknown[]).includes(value.side)) return false;
  switch (value.kind) {
    case 'check': return isInt(value.index, 0, 5);
    case 'save':
    case 'skill': return isInt(value.index, 0, SHEET_LIMITS.bonuses - 1);
    case 'text': return isInt(value.section, 0, SHEET_LIMITS.sections - 1) && isInt(value.item, 0, SHEET_LIMITS.items - 1) && isInt(value.index, 0, 99)
      && (value.text === undefined || isText(value.text, SHEET_LIMITS.rollText));
    case 'card': return isInt(value.index, 0, CARD_LIMITS.rolls - 1) && isText(value.text, CARD_LIMITS.rollText);
    default: return false;
  }
}

function isBonusList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= SHEET_LIMITS.bonuses
    && value.every((entry) => isObject(entry) && isText(entry.label, 40) && isInt(entry.bonus, -99, 99));
}

function isPlayerSheet(value: unknown): value is PlayerSheet {
  if (!isObject(value)) return false;
  return isText(value.name, SHEET_LIMITS.name) && isTextOrNull(value.subtitle, SHEET_LIMITS.short) && isTextOrNull(value.ac, SHEET_LIMITS.short)
    && isTextOrNull(value.hp, SHEET_LIMITS.short) && isTextOrNull(value.speed, SHEET_LIMITS.short)
    && (value.stats === null || (Array.isArray(value.stats) && value.stats.length === 6 && value.stats.every((score) => isInt(score, -999, 999))))
    && isBonusList(value.saves) && isBonusList(value.skills)
    && Array.isArray(value.lines) && value.lines.length <= SHEET_LIMITS.lines
    && value.lines.every((line) => isObject(line) && isText(line.label, 40) && isText(line.text, SHEET_LIMITS.line))
    && Array.isArray(value.sections) && value.sections.length <= SHEET_LIMITS.sections
    && value.sections.every((section) => isObject(section) && isText(section.title, 40) && Array.isArray(section.items)
      && section.items.length <= SHEET_LIMITS.items
      && section.items.every((item) => isObject(item) && isText(item.name, SHEET_LIMITS.name) && isText(item.desc, SHEET_LIMITS.desc) && (item.rollable === undefined || item.rollable === true)));
}

function isSheetResource(value: unknown): value is SheetResource {
  return isObject(value) && isText(value.name, 60) && isFiniteNumber(value.current) && isFiniteNumber(value.max)
    && (value.color === undefined || (typeof value.color === 'string' && HEX.test(value.color)));
}

export function isTokenSheets(value: unknown): value is TokenSheet[] {
  return Array.isArray(value) && value.length <= SHEET_LIMITS.tokens && value.every((entry) => isObject(entry)
    && isText(entry.tokenId, 128) && entry.tokenId.length > 0 && isTextOrNull(entry.name, SHEET_LIMITS.name)
    && Array.isArray(entry.resources) && entry.resources.length <= SHEET_LIMITS.resources && entry.resources.every(isSheetResource)
    && (entry.sheet === null || isPlayerSheet(entry.sheet)) && (entry.card === undefined || isSheetCard(entry.card)));
}

/** A resource colour as a sheet may carry it. */
export function sheetColor(value: unknown): string | undefined {
  return typeof value === 'string' && HEX.test(value) ? value : undefined;
}
