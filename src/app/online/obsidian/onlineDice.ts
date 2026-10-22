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
export function sheetThrow(entry: TokenSheet, ref: SheetRollRef, rules: OfferedDiceRules | null): Omit<PlayerDiceRequest, 'sheet'> | null {
  const formula = ref.kind === 'card'
    ? (entry.card ? cardRollFormula(entry.card, ref.index, ref.text) : null)
    : (entry.sheet ? sheetRollFormula(entry.sheet, ref) : null);
  if (!formula) return null;
  const own = thrownDice(formula);
  if (!own) return null;
  const base = own.count === 0 ? thrownDice(rules?.defaultRoll ?? '1d20') : null;
  if (own.count === 0 && !base) return null;
  const dice = base ? base.dice : own.dice;
  const count = base ? base.count : own.count;
  const modifier = own.modifier + (base?.modifier ?? 0);
  const most = DICE_LIMITS.dicePerRoll - (ref.side ? 1 : 0);
  if (count < 1 || count > most || Math.abs(modifier) > PHYSICAL_MODIFIER) return null;
  const label = ref.kind === 'card' ? entry.card?.rolls[ref.index]?.label : entry.sheet ? sheetRollLabel(entry.sheet, ref) : undefined;
  return { dice, modifier, ...(label ? { label } : {}), ...(ref.side ? { advantage: ref.side } : {}) };
}

/** A formula's dice by kind, how many, and its constants; null when it does not parse or holds a die the board cannot throw. */
function thrownDice(formula: string): { dice: PlayerDiceRequest['dice']; count: number; modifier: number } | null {
  const parsed = parseFormula(formula);
  if (!parsed.ok) return null;
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
