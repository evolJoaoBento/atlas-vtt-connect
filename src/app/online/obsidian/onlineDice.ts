/**
 * The shared dice log in Atlas's dice log panel: each entry as one of Atlas's rolls, under the
 * roller's name ("Anna · Cave" while it carries a scene). These rolls live only in the online scene's store, which is never saved, and
 * never go through Atlas's document-wide dice event, which every open map would record.
 */
import { isDieType, type DiceRollResult, type DiceSelection } from '@atlas-vtt/shared/rules';
import { entryRolls, rollerLabel } from '../page/diceLogModel';
import { DICE_LIMITS, type DiceLogEntry } from '../tools/toolMessages';

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
