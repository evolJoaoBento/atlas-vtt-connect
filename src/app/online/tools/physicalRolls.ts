/**
 * A player's physical roll (`dice-result`: dice thrown on Tabletop's board) as the GM takes it into Atlas's log. The
 * dice are the player's, everything else is the GM's: the total and the critical result are worked out here by the
 * rules of the collection holding the player's map, an explosion counts only where those rules explode that die on
 * that value, and the roll is built from named fields only, so nothing else the player sent reaches Atlas.
 */
import type { DiceRollResult } from '@atlas-vtt/api-types';
import { randomId } from '../ids';
import { dieTagOf } from './diceTags';
import { isOfferedDiceRules, playerRollFormula, type OfferedDiceRules, type PhysicalDie, type PhysicalRoll } from './toolMessages';

/** Atlas's defaults: what a map outside every collection rolls by. */
export const DEFAULT_DICE_RULES: OfferedDiceRules = Object.freeze({ defaultRoll: '1d20', crit: 'natural' as const });

const SIDES: Readonly<Record<PhysicalDie['die'], number>> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 };

/** A die of a finished roll as the critical rule and the total read it. */
export interface CountedDie {
  die: string;
  value: number;
  max: number;
  exploded?: true;
  negative?: true;
  dropped?: true;
}

/** The die of the rules' default roll (`NdS`), e.g. `d20`; null when it is not one dice group. */
function defaultDieOf(rules: OfferedDiceRules): string | null {
  const match = /^(\d*)d(\d+)$/i.exec(rules.defaultRoll.trim());
  return match && (match[1] === '' || Number(match[1]) >= 1) ? `d${Number(match[2])}` : null;
}

/**
 * Whether a die showing `value` explodes: one of its `highFaces` highest faces rolls again and adds ('up'), one of its
 * `lowFaces` lowest rolls again and subtracts ('down'). `isDefault`: a die of the default roll's kind; `fromExplosion`:
 * thrown for an explosion, so it explodes only if the rule repeats.
 */
function explosion(rules: OfferedDiceRules, die: PhysicalDie, isDefault: boolean): 'up' | 'down' | null {
  const rule = rules.explode;
  if (!rule || (rule.dice === 'default' && !isDefault) || (die.exploded && !rule.repeats)) return null;
  if (rule.highFaces > 0 && die.value > SIDES[die.die] - rule.highFaces) return 'up';
  if (rule.lowFaces > 0 && die.value <= rule.lowFaces) return 'down';
  return null;
}

/** The roll's critical result, from its default dice that count: not dropped, not thrown for an explosion. */
export function critOf(rules: OfferedDiceRules, rolls: readonly CountedDie[]): 'success' | 'failure' | undefined {
  const kind = defaultDieOf(rules);
  const dice = rolls.filter((roll) => roll.die === kind && !roll.dropped && !roll.exploded && !roll.negative);
  if (dice.length === 0) return undefined;
  switch (rules.crit) {
    case 'natural':
      if (dice.some((roll) => roll.value === roll.max)) return 'success';
      return dice.some((roll) => roll.value === 1) ? 'failure' : undefined;
    case 'roll-under':
      if (dice.some((roll) => roll.value === 1)) return 'success';
      return dice.some((roll) => roll.value === roll.max) ? 'failure' : undefined;
    case 'doubles':
      return dice.length > 1 && dice.every((roll) => roll.value === dice[0]!.value) ? 'success' : undefined;
    case 'high-total': {
      const sum = dice.reduce((acc, roll) => acc + roll.value, 0);
      const highest = dice.reduce((acc, roll) => acc + roll.max, 0);
      return sum >= highest - 1 ? 'success' : undefined;
    }
    default:
      return undefined;
  }
}

/** The dice that count, a negative one subtracting, and the modifier. */
export function totalOf(rolls: readonly CountedDie[], modifier: number): number {
  return rolls.reduce((acc, roll) => (roll.dropped ? acc : acc + (roll.negative ? -roll.value : roll.value)), modifier);
}

/**
 * Throws unless every `exploded` die was earned: an earlier die of its kind exploded under the rules, in the direction
 * its sign shows (down subtracts; up keeps the sign of the die it came from), and no die earned two. A die thrown for
 * an explosion may come anywhere after its die (Tabletop adds them as they land). An explosion earned but never thrown
 * is no reason to refuse: a roll stops adding dice at 20. A negative die no explosion threw is refused too, and so is
 * a dropped die marked exploded: a die set aside (advantage) earns no explosion.
 */
function checkExplosions(rules: OfferedDiceRules, rolls: readonly PhysicalDie[]): void {
  const kind = defaultDieOf(rules);
  /** Per die kind, the explosions earned and not yet thrown, by whether the die they add subtracts. */
  const owed = new Map<string, { adds: number; subtracts: number }>();
  for (const die of rolls) {
    const earned = owed.get(die.die) ?? { adds: 0, subtracts: 0 };
    owed.set(die.die, earned);
    if (die.exploded && die.dropped) throw new Error(`a dropped ${die.die} marked exploded`);
    if (die.exploded) {
      const side = die.negative ? 'subtracts' : 'adds';
      if (earned[side] === 0) throw new Error(`a ${die.die} marked exploded that no die of the roll exploded into`);
      earned[side] -= 1;
    } else if (die.negative) {
      throw new Error(`a ${die.die} that subtracts without an explosion`);
    }
    if (die.dropped) continue;
    const direction = explosion(rules, die, die.die === kind);
    if (direction === 'down' || (direction === 'up' && die.negative)) earned.subtracts += 1;
    else if (direction === 'up') earned.adds += 1;
  }
}

/**
 * The roll Atlas logs for a player's physical throw, under `rolledBy` (the player's name, as `dice-roll` names it) and
 * named after `ability` when it is a roll of their sheet the GM found. Every die states its lowest face (`min: 1`), so
 * Atlas shows a result card and does not throw its own dice: these were thrown on the board. Throws when the GM
 * refuses the roll: every die dropped, or an explosion the rules do not allow.
 */
export function physicalRollResult(message: PhysicalRoll, rules: OfferedDiceRules, rolledBy: string, ability?: string): DiceRollResult {
  checkExplosions(rules, message.rolls);
  if (message.rolls.every((die) => die.dropped)) throw new Error('every die was dropped');
  const rolls = message.rolls.map((die) => ({
    die: die.die,
    value: die.value,
    max: SIDES[die.die],
    min: 1,
    ...(die.negative ? { negative: true as const } : {}),
    ...(die.exploded ? { exploded: true as const } : {}),
    ...(die.dropped ? { dropped: true as const } : {}),
    // A tag goes only well-formed: a name without controls or invisible formatting, at most 32 characters.
    ...dieTagOf(die),
  }));
  // The dice thrown, not those an explosion added nor those set aside, as `dice-roll` formulas read ("2d6+1").
  const thrown: Partial<Record<string, number>> = {};
  for (const die of rolls) if (!die.exploded && !die.dropped) thrown[die.die] = (thrown[die.die] ?? 0) + 1;
  const formula = Object.keys(thrown).length > 0 ? playerRollFormula(thrown, message.modifier) : null;
  if (formula === null) throw new Error('no die of the roll counts as thrown');
  const crit = critOf(rules, rolls);
  return {
    id: randomId(),
    timestamp: Date.now(),
    formula,
    rolls,
    modifiers: message.modifier,
    total: totalOf(rolls, message.modifier),
    ...(crit ? { crit: crit === 'success' ? 'high' as const : 'low' as const } : {}),
    rolledBy,
    // Named after the player in a stock Atlas's log and toasts through the source, as `dice.roll` names a player's roll.
    source: { type: 'toolbar', tokenName: rolledBy, ...(ability ? { abilityName: ability } : {}) },
  };
}

/** Dice rules as the GM offers them and judges physical rolls by: named fields only; Atlas's defaults when they do not check. */
export function offeredDiceRules(value: unknown): OfferedDiceRules {
  if (typeof value !== 'object' || value === null) return DEFAULT_DICE_RULES;
  const { defaultRoll, crit, explode } = value as Record<string, unknown>;
  const rules: Record<string, unknown> = { defaultRoll, crit };
  if (typeof explode === 'object' && explode !== null) {
    const { dice, repeats, highFaces, lowFaces } = explode as Record<string, unknown>;
    rules.explode = { dice, repeats, highFaces, lowFaces };
  }
  return isOfferedDiceRules(rules) ? rules : DEFAULT_DICE_RULES;
}
