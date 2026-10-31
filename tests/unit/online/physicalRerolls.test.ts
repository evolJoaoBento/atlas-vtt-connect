/**
 * Atlas's reroll notation (`2d6r<2`) for the dice a player throws on Tabletop's board: the reader checked against copies of
 * Atlas's own functions (0.10.2: `JCn`, `ife`, `UCn`), what the player's side asks of the board, the wire, and what the GM
 * accepts back (the rule is the GM's own, from its copy of the sheet roll, never the message's).
 */
import { describe, expect, it } from 'vitest';
import { sheetThrow } from '../../../src/app/online/obsidian/onlineDice';
import { meetsReroll, readThrownTerms } from '../../../src/app/online/tools/diceRerolls';
import { critOf, physicalRollResult, rerollExpectation, totalOf } from '../../../src/app/online/tools/physicalRolls';
import { sheetRollFormula, type SheetRollRef, type TokenSheet } from '../../../src/app/online/tools/sheets';
import { diceLogEntry, isPhysicalRoll, type OfferedDiceRules, type PhysicalDie, type PhysicalRoll } from '../../../src/app/online/tools/toolMessages';

// ---- Atlas's own functions, transcribed from its 0.10.2 build ----
const ATLAS_REPEAT = 10;
type Rule = { operator: string; value: number };
/** `JCn([, t, e, n])` for the match of `YCn` = /r([or]?)(?:(<=|>=|<|>)?(\d{1,4}))?/. */
const atlasRule = ([, t, e, n]: [string, string, string | undefined, string | undefined]): { when: Rule; limit: number } =>
  ({ when: { operator: e ?? '=', value: n === undefined ? 1 : Number(n) }, limit: t === 'r' ? ATLAS_REPEAT : 1 });
const atlasMeets = (value: number, { operator, value: target }: Rule): boolean => {
  switch (operator) {
    case '=': return value === target;
    case '<': return value < target;
    case '<=': return value <= target;
    case '>': return value > target;
    default: return value >= target;
  }
};

const D20: OfferedDiceRules = { defaultRoll: '1d20', crit: 'natural' };
const die = (kind: PhysicalDie['die'], value: number, flags: Partial<PhysicalDie> = {}): PhysicalDie => ({ die: kind, value, ...flags });
const out = (kind: PhysicalDie['die'], value: number): PhysicalDie => die(kind, value, { rerolled: true });
const roll = (rolls: PhysicalDie[], modifier = 0): PhysicalRoll => ({ rolls, modifier });
const thrown = (formula: string, rolls: PhysicalDie[], modifier = 0, rules: OfferedDiceRules = D20) =>
  physicalRollResult(roll(rolls, modifier), rules, 'Anna', 'Volley', rerollExpectation(formula));

describe('the reader of a roll formula with a reroll', () => {
  it('reads the rule as Atlas does: r and ro once, rr ten times, a bare r rerolls ones, no operator means equals', () => {
    for (const [text, match] of [
      ['2d6r<2', ['', '', '<', '2']], ['2d6ro<2', ['', 'o', '<', '2']], ['2d6rr<2', ['', 'r', '<', '2']], ['2d6r', ['', '', undefined, undefined]],
      ['1d20ro1', ['', 'o', undefined, '1']], ['4d6rr<=2', ['', 'r', '<=', '2']], ['1d20r>=19', ['', '', '>=', '19']], ['1d10r>9', ['', '', '>', '9']], ['2d8r3', ['', '', undefined, '3']],
    ] as Array<[string, [string, string, string | undefined, string | undefined]]>) {
      const ours = readThrownTerms(text);
      const atlas = atlasRule(match);
      const die = Object.keys(ours!.dice)[0] as 'd6';
      expect(ours?.reroll[die], text).toEqual({ op: atlas.when.operator, value: atlas.when.value, limit: atlas.limit });
    }
  });

  it('reads the dice, the constants and the count of a formula', () => {
    expect(readThrownTerms('2d6r<2+3')).toEqual({ dice: { d6: 2 }, count: 2, modifier: 3, reroll: { d6: { op: '<', value: 2, limit: 1 } } });
    expect(readThrownTerms('2d6r<2+1d8-1')).toMatchObject({ dice: { d6: 2, d8: 1 }, count: 3, modifier: -1, reroll: { d6: { op: '<', value: 2, limit: 1 } } });
    expect(readThrownTerms('d%r<5')).toMatchObject({ dice: { d100: 1 }, reroll: { d100: { op: '<', value: 5, limit: 1 } } });
    expect(readThrownTerms(' 1d20ro1 + 5 ')).toMatchObject({ dice: { d20: 1 }, modifier: 5 });
    // A formula with no reroll reads, with no rule.
    expect(readThrownTerms('2d6+3')).toEqual({ dice: { d6: 2 }, count: 2, modifier: 3, reroll: {} });
  });

  it('tests a value against the rule as Atlas does, at every operator', () => {
    for (const operator of ['=', '<', '<=', '>', '>=']) {
      for (const target of [1, 3, 6]) {
        for (let value = 1; value <= 6; value++) {
          expect(meetsReroll({ op: operator as '=', value: target }, value), `${value} ${operator} ${target}`).toBe(atlasMeets(value, { operator, value: target }));
        }
      }
    }
  });

  it('reads nothing the board cannot throw: explosions, keeps, success counts, Fate dice, labels, a subtracted group, junk', () => {
    for (const text of ['2d6r<2!', '2d6!r<2', '4d6r<2kh3', '4d6kh3', '6d10>=8', '6d10r1>=8', '4dFr1', '2d6r<2[Fire]', '-2d6r<2', '2d6r=3', '2d6r<', '2d6r<2 fire', '', 'r<2', '0d6r1', '2d7r1', '2d6r<2 2d6']) {
      expect(readThrownTerms(text), text).toBeNull();
    }
  });

  it('reads nothing where the request could not say it: one kind of die with different rules, or with a rule on only some of it', () => {
    expect(readThrownTerms('2d6r<2+1d6r<3')).toBeNull();
    expect(readThrownTerms('2d6r<2+1d6')).toBeNull();
    expect(readThrownTerms('2d6+1d6r<2')).toBeNull();
    expect(readThrownTerms('2d6r<2+1d6r<2')).toMatchObject({ dice: { d6: 3 }, reroll: { d6: { op: '<', value: 2, limit: 1 } } });
    expect(readThrownTerms('2d6r<2+1d8r>7')).toMatchObject({ reroll: { d6: { op: '<', value: 2, limit: 1 }, d8: { op: '>', value: 7, limit: 1 } } });
  });

  it('reads nothing for a rule every face meets, which would throw every die away', () => {
    for (const text of ['1d6r<7', '1d6r>=1', '2d4r<=4', '1d20r>0', '1d6r<=6']) expect(readThrownTerms(text), text).toBeNull();
    // A rule no face meets is thrown (it rerolls nothing), as is the one that leaves a face.
    expect(readThrownTerms('1d6r>6')).not.toBeNull();
    expect(readThrownTerms('1d6r<6')).not.toBeNull();
  });
});

describe('a sheet roll as the player asks the board to throw it', () => {
  const textSheet = (desc: string): TokenSheet => ({
    tokenId: 't1', name: 'Anna', resources: [],
    sheet: { name: 'Anna', subtitle: null, ac: null, hp: null, speed: null, stats: [10, 10, 10, 10, 10, 10], saves: [], skills: [], lines: [], sections: [{ title: 'Actions', items: [{ name: 'Volley', desc }] }] },
  });
  const ref = (text: string, side?: 'advantage' | 'disadvantage'): SheetRollRef => ({ kind: 'text', section: 0, item: 0, index: 0, text, ...(side ? { side } : {}) });
  const REROLL = { d6: { op: '<', value: 2, limit: 1 } };

  it('keeps the reroll in the formula text a sheet roll comes to (the GM and the player read the same text)', () => {
    const entry = textSheet('Hit: 2d6r<2+3 fire damage.');
    const formula = sheetRollFormula(entry.sheet!, ref('2d6r<2+3'));
    expect(formula).toBe('2d6r<2+3');
    expect(rerollExpectation(formula ?? undefined)).toEqual({ d6: { rule: REROLL.d6, count: 2 } });
  });

  it('asks a board that rerolls for 2d6r<2 with its rule, and the plain 2d6 as before', () => {
    expect(sheetThrow(textSheet('Hit: 2d6r<2 fire.'), ref('2d6r<2'), null, true)).toEqual({ dice: { d6: 2 }, modifier: 0, reroll: REROLL, label: 'Volley' });
    expect(sheetThrow(textSheet('Hit: 2d6r<2+3 fire.'), ref('2d6r<2+3'), null, true)).toMatchObject({ dice: { d6: 2 }, modifier: 3, reroll: REROLL });
    const plain = sheetThrow(textSheet('Hit: 2d6 fire.'), ref('2d6'), null, true);
    expect(plain).toMatchObject({ dice: { d6: 2 } });
    expect(plain).not.toHaveProperty('reroll');
  });

  it('asks nothing of a board that does not say it rerolls: such a board would throw 2d6 plain and mark nothing', () => {
    expect(sheetThrow(textSheet('Hit: 2d6r<2 fire.'), ref('2d6r<2'), null)).toBeNull();
    expect(sheetThrow(textSheet('Hit: 2d6r<2 fire.'), ref('2d6r<2'), null, false)).toBeNull();
  });

  it('throws nothing it could throw wrongly: a rule every face meets, a side, the collection\'s explosions, many dice', () => {
    expect(sheetThrow(textSheet('Hit: 1d6r<7 fire.'), ref('1d6r<7'), null, true)).toBeNull();
    expect(sheetThrow(textSheet('Hit: 1d20r<2 fire.'), ref('1d20r<2', 'advantage'), null, true)).toBeNull();
    const explodes: OfferedDiceRules = { defaultRoll: '1d6', crit: 'none', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 0 } };
    expect(sheetThrow(textSheet('Hit: 2d6r<2 fire.'), ref('2d6r<2'), explodes, true)).toBeNull();
    expect(sheetThrow(textSheet('Hit: 2d6r<2 fire.'), ref('2d6r<2'), { ...explodes, explode: { ...explodes.explode!, dice: 'all' } }, true)).toBeNull();
    // Explosions of a different kind of die do not touch this one.
    expect(sheetThrow(textSheet('Hit: 2d6r<2 fire.'), ref('2d6r<2'), { ...explodes, defaultRoll: '1d20' }, true)).toMatchObject({ reroll: REROLL });
    expect(sheetThrow(textSheet('Hit: 21d6r<2 fire.'), ref('21d6r<2'), null, true)).toBeNull();
  });

  it('leaves keeps and success counts to the GM\'s Atlas, as before (they are not thrown on the board)', () => {
    expect(sheetThrow(textSheet('Hit: 4d6kh3 fire.'), ref('4d6kh3'), null, true)).toBeNull();
    expect(sheetThrow(textSheet('Hit: 6d10>=8 fire.'), ref('6d10>=8'), null, true)).toBeNull();
  });
});

describe('a die marked rerolled on the wire', () => {
  it('is accepted, and refused beside dropped or as anything but true', () => {
    expect(isPhysicalRoll(roll([out('d6', 1), die('d6', 5)]))).toBe(true);
    expect(isPhysicalRoll(roll([die('d6', 1, { rerolled: true, dropped: true }), die('d6', 5)]))).toBe(false);
    for (const rerolled of [false, 1, 'true', null]) expect(isPhysicalRoll(roll([{ ...die('d6', 1), rerolled } as unknown as PhysicalDie])), String(rerolled)).toBe(false);
    // An older peer sends none, and a dropped die alone still reads.
    expect(isPhysicalRoll(roll([die('d6', 1, { dropped: true }), die('d6', 5)]))).toBe(true);
  });
});

describe('a roll with rerolled dice, as the GM takes it', () => {
  // The vendored `RolledDie` predates the mark, which Atlas 0.10.2 carries.
  const marked = (result: ReturnType<typeof thrown>) => result.rolls.map((d) => [d.value, (d as { rerolled?: true }).rerolled ?? false]);

  it('counts the dice that stand: the total, the critical result and the thrown formula skip a rerolled die', () => {
    // 2d6r<2 rolled 1, 5, 4: the 1 is thrown away. 5 + 4 + 3 = 12; Atlas's card sums the same dice.
    const result = thrown('2d6r<2+3', [out('d6', 1), die('d6', 5), die('d6', 4)], 3);
    expect(result.total).toBe(12);
    expect(result.formula).toBe('2d6+3');
    expect(marked(result)).toEqual([[1, true], [5, false], [4, false]]);
    // A rerolled natural 20 is no critical hit, and a rerolled 1 no fumble.
    const crits = { defaultRoll: '1d20', crit: 'natural' } as const;
    expect(thrown('1d20r>=19', [out('d20', 20), die('d20', 8)], 0, crits).crit).toBeUndefined();
    expect(thrown('1d20ro<3', [out('d20', 1), die('d20', 19)], 0, crits).crit).toBeUndefined();
    expect(thrown('1d20ro<3', [out('d20', 1), die('d20', 20)], 0, crits).crit).toBe('high');
    expect(totalOf([{ die: 'd6', value: 1, max: 6, rerolled: true }, { die: 'd6', value: 4, max: 6 }], 0)).toBe(4);
    expect(critOf(crits, [{ die: 'd20', value: 20, max: 20, rerolled: true }, { die: 'd20', value: 5, max: 20 }])).toBeUndefined();
  });

  it('reaches the players\' log with the die struck through', () => {
    const entry = diceLogEntry(thrown('2d6r<2', [out('d6', 1), die('d6', 5), die('d6', 4)]), 'Anna');
    expect(entry?.dice).toEqual([
      expect.objectContaining({ die: 'd6', value: 1, rerolled: true }), expect.objectContaining({ die: 'd6', value: 5 }), expect.objectContaining({ die: 'd6', value: 4 }),
    ]);
    expect(entry?.dice[1]).not.toHaveProperty('rerolled');
    expect(entry?.total).toBe(9);
  });

  it('takes a die that stands and a rerolled die in any order', () => {
    expect(thrown('2d6r<2', [die('d6', 5), die('d6', 4), out('d6', 1)]).total).toBe(9);
    expect(thrown('3d6r<3', [out('d6', 2), out('d6', 1), die('d6', 6), die('d6', 5), die('d6', 4)]).total).toBe(15);
  });

  it('refuses a die marked rerolled that the rule would not reroll (a player cannot strike out a bad die)', () => {
    expect(() => thrown('2d6r<2', [out('d6', 3), die('d6', 5), die('d6', 4)])).toThrow(/marked rerolled showing 3/);
    expect(() => thrown('1d6ro1', [out('d6', 2), die('d6', 5)])).toThrow(/does not reroll/);
  });

  it('refuses a die that meets the rule and stands unmarked, while a die that has no rerolls left is let stand', () => {
    expect(() => thrown('2d6r<2', [die('d6', 1), die('d6', 5)])).toThrow(/was not rerolled/);
    // `ro` rerolls once: the replacement may meet the rule and stand.
    expect(thrown('1d6ro1', [out('d6', 1), die('d6', 1)]).total).toBe(1);
    // `rr` goes on until a die stands: ten rerolls, then the last stands whatever it shows.
    const ten = Array.from({ length: 10 }, () => out('d6', 1));
    expect(thrown('1d6rr1', [...ten, die('d6', 1)]).total).toBe(1);
    expect(() => thrown('1d6rr1', [...ten.slice(0, 4), die('d6', 1)])).toThrow(/was not rerolled/);
  });

  it('refuses more rerolls than the rule allows a die', () => {
    expect(() => thrown('1d6ro<3', [out('d6', 1), out('d6', 2), die('d6', 4)])).toThrow(/more than 1 for each of 1/);
    expect(() => thrown('2d6r<2', [out('d6', 1), out('d6', 1), out('d6', 1), die('d6', 5), die('d6', 4)])).toThrow(/more than 1 for each of 2/);
    // One rerolled die per slot is what `r` allows, however the dice are spread.
    expect(thrown('2d6r<2', [out('d6', 1), out('d6', 1), die('d6', 5), die('d6', 4)]).total).toBe(9);
    expect(() => thrown('1d6rr1', [...Array.from({ length: 11 }, () => out('d6', 1)), die('d6', 3)])).toThrow(/more than 10/);
  });

  it('refuses a roll that holds other dice than the sheet roll throws', () => {
    expect(() => thrown('2d6r<2', [die('d6', 5)])).toThrow(/1 d6 stand where the roll throws 2/);
    expect(() => thrown('2d6r<2', [die('d6', 5), die('d6', 4), die('d6', 6)])).toThrow(/3 d6 stand where the roll throws 2/);
    expect(() => thrown('2d6r<2', [die('d20', 5)])).toThrow(/0 d6 stand/);
  });

  it('refuses a rerolled die in a free roll from the tray, in a sheet roll with no reroll, and of a kind the rule does not cover', () => {
    expect(() => physicalRollResult(roll([out('d6', 1), die('d6', 5)]), D20, 'Anna')).toThrow(/no reroll rule/);
    expect(() => thrown('2d6+3', [out('d6', 1), die('d6', 5), die('d6', 4)])).toThrow(/no reroll rule/);
    expect(() => thrown('2d6r<2+1d8', [out('d8', 1), die('d8', 5), die('d6', 5), die('d6', 4)])).toThrow(/d8 marked rerolled/);
    // The message cannot bring its own rule: a roll with no expectation from the GM's copy has none.
    expect(() => physicalRollResult({ ...roll([out('d6', 1), die('d6', 5)]), sheet: { tokenId: 't1', roll: { kind: 'check', index: 0 } } } as PhysicalRoll, D20, 'Anna', 'Volley')).toThrow(/no reroll rule/);
  });

  it('refuses a rerolled die that is also an explosion or subtracts, and a roll with nothing left standing', () => {
    expect(() => thrown('2d6r<2', [die('d6', 1, { rerolled: true, exploded: true }), die('d6', 5), die('d6', 4)])).toThrow(/rerolled d6 marked exploded/);
    expect(() => thrown('2d6r<2', [die('d6', 1, { rerolled: true, negative: true }), die('d6', 5), die('d6', 4)])).toThrow(/negative/);
    expect(() => physicalRollResult(roll([out('d6', 1)]), D20, 'Anna')).toThrow();
  });

  it('lets a roll that is full end with a die that met the rule and has no replacement', () => {
    // 20 dice is the most a roll holds: Tabletop stops rerolling there.
    const full = [...Array.from({ length: 19 }, () => die('d6', 5)), die('d6', 1)];
    expect(thrown('20d6r<2', full).total).toBe(19 * 5 + 1);
    // One short of full, the same die must have been rerolled.
    expect(() => thrown('19d6r<2', [...Array.from({ length: 18 }, () => die('d6', 5)), die('d6', 1)])).toThrow(/was not rerolled/);
    // A full roll still refuses a die marked rerolled that the rule does not reroll, and a die over the limit.
    expect(() => thrown('19d6r<2', [...Array.from({ length: 18 }, () => die('d6', 5)), out('d6', 4), die('d6', 6)])).toThrow(/does not reroll/);
  });

  it('earns no explosion from a die that was thrown away', () => {
    const exploding: OfferedDiceRules = { defaultRoll: '1d6', crit: 'none', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } };
    // Not asked of the board (a reroll beside explosions is the GM's roll), but a roll that arrives is judged: a 6 thrown away owes no explosion.
    expect(() => thrown('1d6r>5', [out('d6', 6), die('d6', 4), die('d6', 3, { exploded: true })], 0, exploding)).toThrow(/no die of the roll exploded into/);
    expect(thrown('1d6r>5', [out('d6', 6), die('d6', 4)], 0, exploding).total).toBe(4);
  });
});
