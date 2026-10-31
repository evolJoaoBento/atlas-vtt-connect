/**
 * The shared dice log in Atlas's dice log panel: each entry as one of Atlas's rolls, under the
 * roller's name ("Anna · Cave" while it carries a scene). These rolls live only in the online scene's store, which is never saved, and
 * never go through Atlas's document-wide dice event, which every open map would record. Also what a sheet roll
 * throws on Tabletop's board (`sheetThrow`): the player's own physical roll comes back as a log entry like any other,
 * shown as a card and never thrown again.
 */
import { isDieType, parseFormula, type DiceRollResult, type DiceSelection } from '@atlas-vtt/shared/rules';
import { entryRolls, rollerLabel } from '../page/diceLogModel';
import { cardRollFormula } from '../tools/sheetCards';
import { readThrownTerms } from '../tools/diceRerolls';
import { sheetRollFormula, sheetRollLabel, type SheetRollRef, type TokenSheet } from '../tools/sheets';
import { DICE_LIMITS, PHYSICAL_MODIFIER, type DiceLogEntry, type OfferedDiceRules } from '../tools/toolMessages';
import type { PlayerDiceRequest } from './playerBoardContract';

export function diceLogResults(entries: readonly DiceLogEntry[]): DiceRollResult[] {
  return entries.map(diceLogResult);
}

/** One entry as Atlas's roll: its dice with their sides and flags, its crit, and how many dice it did not list. */
export function diceLogResult(entry: DiceLogEntry): DiceRollResult {
  return {
    id: entry.id,
    timestamp: entry.at,
    formula: entry.formula,
    rolls: entryRolls(entry),
    modifiers: entry.modifier,
    total: entry.total,
    crit: entry.crit ?? null,
    ...(entry.unlisted !== undefined && { unlistedDice: entry.unlisted }),
    rolledBy: rollerLabel(entry),
  };
}

/** The tray's picks as a roll's dice: Atlas's tray dice with a count above zero; null when empty or above the GM's limit. */
export function traySelection(selection: Readonly<Record<string, number>>): DiceSelection | null {
  const dice: DiceSelection = {};
  let total = 0;
  for (const [die, count] of Object.entries(selection)) {
    if (!isDieType(die) || count <= 0) continue;
    dice[die] = count;
    total += count;
  }
  return total >= 1 && total <= DICE_LIMITS.dicePerRoll ? dice : null;
}

/**
 * A roll of the player's sheet as Tabletop's board throws it: the formula's dice and its bonus, a bare bonus on the
 * default roll of the map's rules (Atlas's 1d20 without them), as the GM would roll it. Null where the board cannot
 * throw it: no such roll, a die the board has not, a die that subtracts or explodes, or more than 20 dice (19 with a
 * side, as the board throws one die more for it).
 */
export function sheetThrow(entry: TokenSheet, ref: SheetRollRef, rules: OfferedDiceRules | null, canReroll = false): Omit<PlayerDiceRequest, 'sheet'> | null {
  const formula = ref.kind === 'card'
    ? (entry.card ? cardRollFormula(entry.card, ref.index, ref.text) : null)
    : (entry.sheet ? sheetRollFormula(entry.sheet, ref) : null);
  if (!formula) return null;
  const own = thrownDice(formula, canReroll);
  if (!own) return null;
  // A reroll is thrown on the board only where nothing else changes the dice: a side adds a die to keep or drop, and the
  // collection's explosions would explode a die the rule may throw away. Any doubt sends the roll to the GM's Atlas.
  const rerolled = Object.keys(own.reroll ?? {}) as Array<keyof NonNullable<typeof own.reroll>>;
  if (rerolled.length > 0 && (ref.side || rerolled.some((die) => explodes(rules, die)))) return null;
  const base = own.count === 0 ? thrownDice(rules?.defaultRoll ?? '1d20', false) : null;
  if (own.count === 0 && !base) return null;
  const dice = base ? base.dice : own.dice;
  const count = base ? base.count : own.count;
  const modifier = own.modifier + (base?.modifier ?? 0);
  const most = DICE_LIMITS.dicePerRoll - (ref.side ? 1 : 0);
  if (count < 1 || count > most || Math.abs(modifier) > PHYSICAL_MODIFIER) return null;
  const label = ref.kind === 'card' ? entry.card?.rolls[ref.index]?.label : entry.sheet ? sheetRollLabel(entry.sheet, ref) : undefined;
  return { dice, modifier, ...(label ? { label } : {}), ...(ref.side ? { advantage: ref.side } : {}), ...(own.reroll && rerolled.length > 0 ? { reroll: own.reroll } : {}) };
}

/** Whether the collection's rules explode a die of this kind: every die, or the default roll's (any explode rule counts, as a doubt). */
function explodes(rules: OfferedDiceRules | null, die: string): boolean {
  const rule = rules?.explode;
  if (!rule) return false;
  return rule.dice === 'all' || die === `d${/d(\d+)/i.exec(rules.defaultRoll)?.[1] ?? ''}`;
}

/**
 * A formula's dice by kind, how many, and its constants; null when it does not parse or holds a die the board cannot
 * throw. With `canReroll` (a board that throws rerolls) a formula Atlas's notation reads with a reroll is thrown too, with
 * its rules; the dice Atlas's own parser here cannot read are tried against `readThrownTerms`.
 */
function thrownDice(formula: string, canReroll: boolean): { dice: PlayerDiceRequest['dice']; count: number; modifier: number; reroll?: PlayerDiceRequest['reroll'] } | null {
  const parsed = parseFormula(formula);
  if (!parsed.ok) {
    if (!canReroll) return null;
    const terms = readThrownTerms(formula);
    return terms && Object.keys(terms.reroll).length > 0 ? { dice: terms.dice, count: terms.count, modifier: terms.modifier, reroll: terms.reroll } : null;
  }
  const dice: PlayerDiceRequest['dice'] = {};
  let count = 0;
  let modifier = 0;
  for (const term of parsed.terms) {
    if (term.kind === 'constant') {
      modifier += term.value;
      continue;
    }
    const die = `d${term.faces}`;
    if (!isDieType(die) || term.negative || term.explosions) return null;
    dice[die] = (dice[die] ?? 0) + term.count;
    count += term.count;
  }
  return { dice, count, modifier };
}
