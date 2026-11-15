/**
 * Atlas's reroll notation (`2d6r<2`, `1d20ro1`, `4d6rr<=2`) for the dice a player throws on Tabletop's board. A die that
 * meets the condition is thrown again, up to `limit` times (`r` and `ro` once, `rr` ten times); each die thrown away
 * stays in the roll, marked `rerolled`, and counts for nothing; the die that replaced it follows. Ported from Atlas's
 * own term grammar (0.10.2: `YCn` for the reroll, `JCn` for its rule, `ife` for the condition, `UCn` for the faces that
 * meet it). The player's side builds the board's request from `readThrownTerms`, and the GM re-derives the rule from
 * its own copy of the roll with the very same function, so the two agree by construction. Pure.
 *
 * Only what the board can throw is read: dice with at most a reroll. A term with an explosion, a keep or a success
 * count, a Fate die, a label, a subtracted group, or a kind of die carrying different rules (a rule applies to a whole
 * kind) reads as null, which sends the roll to the GM's Atlas, as before.
 */
import type { PhysicalDie } from './toolMessages';

export type RerollDie = PhysicalDie['die'];
export type RerollOp = '<' | '<=' | '>' | '>=' | '=';

/** A reroll rule, in the shape Tabletop's `RollRequest.reroll` takes. */
export interface RerollRule {
  op: RerollOp;
  value: number;
  limit: number;
}

/** What `rr` allows: Atlas's `TE`. */
export const REROLL_REPEAT_LIMIT = 10;

const FACES: Readonly<Record<RerollDie, number>> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 };

/** Whether a die showing `value` meets the rule's condition (Atlas's `ife`). */
export function meetsReroll(rule: Pick<RerollRule, 'op' | 'value'>, value: number): boolean {
  switch (rule.op) {
    case '=': return value === rule.value;
    case '<': return value < rule.value;
    case '<=': return value <= rule.value;
    case '>': return value > rule.value;
    case '>=': return value >= rule.value;
  }
}

/** How many of the die's faces meet the rule (Atlas's `UCn`). */
function facesMeeting(rule: RerollRule, faces: number): number {
  let met = 0;
  for (let face = 1; face <= faces; face++) if (meetsReroll(rule, face)) met++;
  return met;
}

export interface ThrownTerms {
  /** The dice by kind, and how many in all. */
  dice: Partial<Record<RerollDie, number>>;
  count: number;
  /** The constants added up. */
  modifier: number;
  /** The rule of each kind that has one. */
  reroll: Partial<Record<RerollDie, RerollRule>>;
}

/**
 * Atlas's dice term (`vBe`, then the reroll `YCn`) or a constant, signed: `2d6r<2`, `+1d8`, `-1`. What follows a reroll
 * (an explosion, a keep, a success count, a label) is left unread, so the next term fails to read and the formula is null.
 */
const TERM = /([+-]?)[ \t]*(?:(\d{0,3})[dD](\d{1,4}|%)(?:r([or]?)(?:(<=|>=|<|>)?(\d{1,4}))?)?|(\d{1,4}))[ \t]*/y;

/**
 * A roll formula as the board can throw it, with its reroll rules; null when it is not one, or a rule cannot be thrown:
 * a kind of die with different rules (or some terms of it with none), a rule every face of the die meets (it would throw
 * every die away to the limit), more than one die kind's worth of anything Tabletop's request cannot say.
 */
export function readThrownTerms(formula: string): ThrownTerms | null {
  const dice: Partial<Record<RerollDie, number>> = {};
  const rules = new Map<RerollDie, RerollRule | null>();
  let count = 0;
  let modifier = 0;
  let terms = 0;
  let cursor = /^[ \t]*/.exec(formula)?.[0].length ?? 0;
  while (cursor < formula.length) {
    TERM.lastIndex = cursor;
    const match = TERM.exec(formula);
    if (!match || (terms > 0 && !match[1])) return null;
    cursor = TERM.lastIndex;
    terms += 1;
    const [, sign, amount, sides, repeat, operator, target, constant] = match;
    if (constant !== undefined) {
      modifier += (sign === '-' ? -1 : 1) * Number(constant);
      continue;
    }
    const kind = `d${sides === '%' ? 100 : Number(sides)}`;
    const number = Number(amount || '1');
    if (sign === '-' || number < 1 || !Object.hasOwn(FACES, kind)) return null;
    const die = kind as RerollDie;
    // A bare `r` rerolls ones; no operator means "equals".
    const rule: RerollRule | null = repeat === undefined ? null : {
      op: (operator ?? '=') as RerollOp,
      value: target === undefined ? 1 : Number(target),
      limit: repeat === 'r' ? REROLL_REPEAT_LIMIT : 1,
    };
    if (rule && facesMeeting(rule, FACES[die]) >= FACES[die]) return null;
    // The request carries one rule for a whole kind of die.
    const seen = rules.get(die);
    if (seen !== undefined && JSON.stringify(seen) !== JSON.stringify(rule)) return null;
    rules.set(die, rule);
    dice[die] = (dice[die] ?? 0) + number;
    count += number;
  }
  if (terms === 0) return null;
  const reroll: Partial<Record<RerollDie, RerollRule>> = {};
  for (const [die, rule] of rules) if (rule) reroll[die] = rule;
  return { dice, count, modifier, reroll };
}
