import { describe, expect, it } from 'vitest';
import { buildSheet, isSheetRollRef, isTokenSheets, sheetRollFormula, sheetRollLabel, textParts } from '../../../src/app/online/tools/sheets';

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

  it('finds the rolls in a text, and the GM finds the same formula again by where it is', () => {
    const parts = textParts('Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.');
    expect(parts.filter((part) => 'roll' in part)).toEqual([
      { text: '+4 to hit', roll: 0, formula: '1d20+4' },
      { text: '1d6 + 2', roll: 1, formula: '1d6+2' },
    ]);
    expect(parts.map((part) => part.text).join('')).toBe('Melee Weapon Attack: +4 to hit, reach 5 ft. Hit: 5 (1d6 + 2) slashing damage.');
    const sheet = buildSheet(GOBLIN)!;
    expect(sheetRollFormula(sheet, { kind: 'text', section: 1, item: 0, index: 1 })).toBe('1d6+2');
    expect(sheetRollFormula(sheet, { kind: 'check', index: 1 })).toBe('1d20+2');
    expect(sheetRollFormula(sheet, { kind: 'check', index: 0 })).toBe('1d20-1');
    expect(sheetRollFormula(sheet, { kind: 'save', index: 0 })).toBe('1d20+4');
    expect(sheetRollFormula(sheet, { kind: 'skill', index: 0 })).toBe('1d20+6');
    expect(sheetRollFormula(sheet, { kind: 'skill', index: 5 })).toBeNull();
    expect(sheetRollFormula(sheet, { kind: 'text', section: 0, item: 0, index: 0 })).toBeNull();
    expect(sheetRollLabel(sheet, { kind: 'text', section: 1, item: 0, index: 0 })).toBe('Scimitar');
    expect(sheetRollLabel(sheet, { kind: 'save', index: 0 })).toBe('Dexterity save');
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
