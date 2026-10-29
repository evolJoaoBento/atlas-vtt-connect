import { describe, expect, it } from 'vitest';
import { buildSheet, isSheetRollRef, isTokenSheets, sheetRollFormula, sheetRollLabel, textParts, toRollFormula } from '../../../src/app/online/tools/sheets';

const GOBLIN = {
  name: 'Goblin', path: 'Bestiary/Goblin.md', image: 'secret/goblin.png', size: 'Small', type: 'humanoid', subtype: 'goblinoid', alignment: 'neutral evil',
  ac: 15, hp: 7, hit_dice: '2d6', speed: '30 ft.', stats: [8, 14, 10, 10, 8, 8],
  saves: [{ dexterity: 4 }], skillsaves: [{ stealth: 6 }, { bad: 'x' }],
  senses: 'darkvision 60 ft., passive Perception 9', languages: ['Common', 'Goblin'], cr: '1/4',
  traits: [{ name: 'Nimble Escape', desc: 'The goblin can take the Disengage or Hide action as a bonus action.' }],
  actions: [{ name: 'Scimitar', desc: 'Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.' }, ['Shortbow', 'Ranged: +4 to hit. Hit: 1d6+2.']],
  notes: 'GM only: the goblin is a spy',
};

describe("a player's sheet", () => {
  it('keeps only the whitelisted fields of a creature, as text', () => {
    const sheet = buildSheet(GOBLIN)!;
    expect(sheet).toMatchObject({
      name: 'Goblin', subtitle: 'Small humanoid (goblinoid), neutral evil', ac: '15', hp: '7 (2d6)', speed: '30 ft.', stats: [8, 14, 10, 10, 8, 8],
      saves: [{ label: 'Dexterity', bonus: 4 }], skills: [{ label: 'Stealth', bonus: 6 }],
    });
    expect(sheet.lines).toEqual([{ label: 'Senses', text: 'darkvision 60 ft., passive Perception 9' }, { label: 'Languages', text: 'Common, Goblin' }, { label: 'Challenge', text: '1/4' }]);
    expect(sheet.sections.map((section) => [section.title, section.items.map((item) => item.name)])).toEqual([['Traits', ['Nimble Escape']], ['Actions', ['Scimitar', 'Shortbow']]]);
    const json = JSON.stringify(sheet);
    expect(json).not.toContain('Bestiary');
    expect(json).not.toContain('secret');
    expect(json).not.toContain('spy');
    expect(isTokenSheets([{ tokenId: 't', name: 'Goblin', resources: [], sheet }])).toBe(true);
  });

  it('finds the rolls in a text as Atlas links them, and the GM finds the same formula again by where it is and what it says', () => {
    const parts = textParts('Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.');
    // As Atlas: "Attack: +4" is the link (the label is stripped), and the bonus stays bare, so Atlas adds it to the
    // dice set's default roll.
    expect(parts.filter((part) => 'roll' in part)).toEqual([
      { text: 'Attack: +4', roll: 0, formula: '+4' },
      { text: '1d6 + 2', roll: 1, formula: '1d6+2' },
    ]);
    expect(parts.map((part) => part.text).join('')).toBe('Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.');
    const sheet = buildSheet(GOBLIN)!;
    expect(sheetRollFormula(sheet, { kind: 'text', section: 1, item: 0, index: 1, text: '1d6 + 2' })).toBe('1d6+2');
    expect(sheetRollFormula(sheet, { kind: 'check', index: 1 })).toBe('+2');
    expect(sheetRollFormula(sheet, { kind: 'check', index: 0 })).toBe('-1');
    expect(sheetRollFormula(sheet, { kind: 'save', index: 0 })).toBe('+4');
    expect(sheetRollFormula(sheet, { kind: 'skill', index: 0 })).toBe('+6');
    expect(sheetRollFormula(sheet, { kind: 'skill', index: 5 })).toBeNull();
    expect(sheetRollFormula(sheet, { kind: 'text', section: 0, item: 0, index: 0 })).toBeNull();
    // Never a roll other than the one clicked: other text at that place, or none sent (an older page), rolls nothing.
    expect(sheetRollFormula(sheet, { kind: 'text', section: 1, item: 0, index: 1, text: '+4' })).toBeNull();
    expect(sheetRollFormula(sheet, { kind: 'text', section: 1, item: 0, index: 1 })).toBeNull();
    expect(sheetRollLabel(sheet, { kind: 'text', section: 1, item: 0, index: 0 })).toBe('Scimitar');
    expect(sheetRollLabel(sheet, { kind: 'save', index: 0 })).toBe('Dexterity save');
  });

  it("reads Foundry and Roll20 notation as Atlas 0.8's links do: rerolls, success counts, d%, Fate dice, labels and the other operators", () => {
    const rolls = (text: string): Array<[string, string]> => textParts(text).flatMap((part) => ('roll' in part ? [[part.text, part.formula] as [string, string]] : []));
    expect(rolls('Roll 2d6r<2 for damage')).toEqual([['2d6r<2', '2d6r<2']]);
    expect(rolls('6d10>=8 successes')).toEqual([['6d10>=8', '6d10>=8']]);
    expect(rolls('6d10cs>5 and 4d6cf<2')).toEqual([['6d10cs>5', '6d10cs>5'], ['4d6cf<2', '4d6cf<2']]);
    expect(rolls('Percentile d% or 2d%')).toEqual([['d%', 'd%'], ['2d%', '2d%']]);
    expect(rolls('Fate 4dF and 4df')).toEqual([['4dF', '4dF'], ['4df', '4df']]);
    expect(rolls('Exploding 1d6xo and 2d6x>=5 and 1d6!!3')).toEqual([['1d6xo', '1d6xo'], ['2d6x>=5', '2d6x>=5'], ['1d6!!3', '1d6!!3']]);
    expect(rolls('Advantage 2d20dl1 or 4d6dh1')).toEqual([['2d20dl1', '2d20dl1'], ['4d6dh1', '4d6dh1']]);
    expect(rolls('Fire 2d6[Fire] + 1d4[Cold] damage')).toEqual([['2d6[Fire] + 1d4[Cold]', '2d6[Fire]+1d4[Cold]']]);
    expect(rolls('A label with a space: 1d8[Light Fire]')).toEqual([['1d8[Light Fire]', '1d8[Light Fire]']]);
    expect(rolls('Multiplied 2d6 * 2 and 1d8 / 2 and 1d4 × 3')).toEqual([['2d6 * 2', '2d6*2'], ['1d8 / 2', '1d8/2'], ['1d4 × 3', '1d4*3']]);
  });

  it("makes one roll of a run of bonuses, as Atlas 0.9.1 does (`+4+1`), and leaves a value that is an `@` reference alone", () => {
    const rolls = (text: string): Array<[string, string]> => textParts(text).flatMap((part) => ('roll' in part ? [[part.text, part.formula] as [string, string]] : []));
    expect(rolls('Attack +4+1 to hit')).toEqual([['+4+1', '+4+1']]);
    expect(rolls('Hit: 2d8+3-1')).toEqual([['2d8+3-1', '2d8+3-1']]);
    // A reference Atlas resolves is no roll, nor the number beside it.
    expect(rolls('1d8 + @str.mod')).toEqual([]);
    expect(rolls('@agility + 2d6')).toEqual([]);
    expect(rolls('Damage 2d8 and @str')).toEqual([['2d8', '2d8']]);
  });

  it('does not take for a roll what only looks like one', () => {
    const rolls = (text: string): string[] => textParts(text).filter((part) => 'roll' in part).map((part) => part.text);
    for (const text of ['Recharge 5-6', 'levels 1–3', 'he said 0d6 is nothing', 'pi is 3.14', 'x2d6 and 5d', 'a d is a letter', 'Very Close - Far', 'paid3d6gold', 'a [label]']) {
      expect(rolls(text)).toEqual([]);
    }
    // A single ! after dice is a sentence's end, and a decimal after a sign is no whole bonus.
    expect(rolls('Roll 2d6! now')).toEqual(['2d6']);
  });

  it("reads dice notation as Atlas's stat blocks do (statblockDiceLinks.test.ts)", () => {
    const linked = (text: string): string[] => textParts(text).filter((part) => 'roll' in part).map((part) => part.text);
    expect(linked('Hit: 19 (2d10 + 8) slashing')).toEqual(['2d10 + 8']);
    expect(linked('(2d6+3) piercing, bite (d8), claws (+5)')).toEqual(['2d6+3', 'd8', '+5']);
    expect(linked('(3d6 + -1)')).toEqual(['3d6 + -1']);
    expect(linked('(1d4 − 1) or (−1)')).toEqual(['1d4 − 1', '−1']);
    expect(linked('Biss (+0, 1d2)')).toEqual(['+0', '1d2']);
    expect(linked('2d6 - 1d4 fire')).toEqual(['2d6 - 1d4']);
    expect(linked('4d6kh3 + 2')).toEqual(['4d6kh3 + 2']);
    expect(linked('Shiv 1d6!i+2 damage')).toEqual(['1d6!i+2']);
    expect(linked('d8!3 and 2d6!!')).toEqual(['d8!3', '2d6!!']);
    expect(linked('Take 2d6!')).toEqual(['2d6']);
    expect(linked('Claws - Very Close - 1d12+2 phy')).toEqual(['1d12+2']);
    expect(linked('x2d6 and 5d')).toEqual([]);
    expect(linked('Recharge 5-6, levels 1–3')).toEqual([]);
    expect(linked('ATK: +4, d20')).toEqual(['ATK: +4', 'd20']);
    expect(toRollFormula('ATK: +4')).toBe('+4');
    expect(toRollFormula('1d4 − 1')).toBe('1d4-1');
    expect(toRollFormula('2d6 – 1d4')).toBe('2d6-1d4');
    expect(toRollFormula('3d6 + -1')).toBe('3d6-1');
  });

  it('takes a side and the clicked text with a roll, and nothing else', () => {
    expect(isSheetRollRef({ kind: 'check', index: 1, side: 'advantage' })).toBe(true);
    expect(isSheetRollRef({ kind: 'text', section: 0, item: 0, index: 0, text: '+4', side: 'disadvantage' })).toBe(true);
    expect(isSheetRollRef({ kind: 'check', index: 1, side: 'both' })).toBe(false);
    expect(isSheetRollRef({ kind: 'text', section: 0, item: 0, index: 0, text: 'x'.repeat(201) })).toBe(false);
    expect(isSheetRollRef({ kind: 'text', section: 0, item: 0, index: 0, text: 4 })).toBe(false);
  });

  it('refuses what is no sheet or no roll, and a creature without a name', () => {
    expect(buildSheet({ ac: 3 })).toBeNull();
    expect(buildSheet({ ac: 3 }, 'Fallback')?.name).toBe('Fallback');
    expect(buildSheet('Goblin')).toBeNull();
    expect(isTokenSheets([{ tokenId: '', name: null, resources: [], sheet: null }])).toBe(false);
    expect(isTokenSheets([{ tokenId: 't', name: null, resources: [{ name: 'HP', current: 'x', max: 3 }], sheet: null }])).toBe(false);
    expect(isTokenSheets([{ tokenId: 't', name: null, resources: [], sheet: { name: 'x'.repeat(500) } }])).toBe(false);
    expect(isSheetRollRef({ kind: 'check', index: 6 })).toBe(false);
    expect(isSheetRollRef({ kind: 'formula', formula: '100d100' })).toBe(false);
    expect(isSheetRollRef({ kind: 'text', section: 0, item: 0, index: 2 })).toBe(true);
  });

  it('cleans control characters and keeps long texts short', () => {
    const sheet = buildSheet({ name: 'A\u0000b\u0007\nc', actions: [{ name: 'X', desc: 'y'.repeat(5000) }] })!;
    expect(sheet.name).toBe('Ab c');
    expect(sheet.sections[0]?.items[0]?.desc).toHaveLength(2000);
  });
});
