import { describe, expect, it } from 'vitest';
import { advantageSide, buildSheet, isTokenSheets, mayHaveAdvantage, SHEET_LIMITS, signed } from '../../../packages/atlas-host/src/sheets/sheets';
import { buildPlayerSheet } from '../../../packages/atlas-host/src/sheets/templateSheets';

// The one sheet model Connect and Tabletop share: what Tabletop's own copy added to Connect's.
describe('the shared sheet model', () => {
  it("opens a list with Fantasy Statblocks' intro to it (`legendary_description`), as an item named as the list", () => {
    const sheet = buildSheet({
      name: 'Dragon',
      legendary_description: 'The dragon can take 3 legendary actions.',
      legendary_actions: [{ name: 'Detect', desc: 'The dragon makes a Wisdom (Perception) check.' }],
      lair_description: 'An intro with no list is shown nowhere.',
    })!;
    expect(sheet.sections).toEqual([{
      title: 'Legendary actions',
      items: [{ name: 'Legendary actions', desc: 'The dragon can take 3 legendary actions.' }, { name: 'Detect', desc: 'The dragon makes a Wisdom (Perception) check.' }],
    }]);
  });

  it('keeps a full list a sheet a page accepts: the intro takes the place of the last item', () => {
    const actions = Array.from({ length: 60 }, (_, index) => ({ name: `Action ${index}`, desc: 'Hit.' }));
    const sheet = buildSheet({ name: 'Horde', legendary_description: 'Intro.', legendary_actions: actions })!;
    expect(sheet.sections[0]!.items).toHaveLength(SHEET_LIMITS.items);
    expect(sheet.sections[0]!.items[0]).toEqual({ name: 'Legendary actions', desc: 'Intro.' });
    expect(isTokenSheets([{ tokenId: 't', name: 'Horde', resources: [], sheet }])).toBe(true);
  });

  it("shows the armour's kind beside the armour class (`ac_class`)", () => {
    expect(buildSheet({ name: 'Knight', ac: 18, ac_class: 'plate' })!.ac).toBe('18 (plate)');
    expect(buildSheet({ name: 'Knight', ac: 18 })!.ac).toBe('18');
  });

  it('gives the side a click asks for (Shift advantage, Alt disadvantage, both none), and which formulas a side changes', () => {
    expect([advantageSide(true, false), advantageSide(false, true), advantageSide(true, true), advantageSide(false, false)]).toEqual(['advantage', 'disadvantage', null, null]);
    expect([mayHaveAdvantage('+5'), mayHaveAdvantage('1d20+3'), mayHaveAdvantage('2d6+1'), mayHaveAdvantage('1d200')]).toEqual([true, true, false, false]);
    expect([signed(3), signed(0), signed(-2)]).toEqual(['+3', '+0', '-2']);
  });

  it("reads a note made with one of Atlas's built-in templates by that template, where the caller has it", () => {
    const cairn = { format: 'atlas-statblock-template', id: 'builtin:cairn-creature', fields: [{ key: 'armor', label: 'Armor', type: 'number' }], layout: { blocks: [{ type: 'stat', field: 'armor' }] } };
    const statblock = { atlasTemplate: 'builtin:cairn-creature', template: null, fields: { name: 'Bog Hag', armor: 1, stats: [12, 9, 7] } };
    const builtIns = (id: string): unknown => (id === cairn.id ? cairn : null);
    expect(buildPlayerSheet(statblock, null, builtIns)).toMatchObject({ name: 'Bog Hag', stats: null, sections: [{ items: [{ name: 'Armor', desc: '1' }] }] });
    // Without one, a built-in reads as a 5e stat block, as before; and a 5e built-in always does, so its abilities roll.
    expect(buildPlayerSheet(statblock)).toMatchObject({ name: 'Bog Hag', stats: null, sections: [] });
    const goblin = { atlasTemplate: 'builtin:5e-2024-monster', template: null, fields: { name: 'Goblin', stats: [8, 14, 10, 10, 8, 8] } };
    expect(buildPlayerSheet(goblin, null, () => cairn)!.stats).toEqual([8, 14, 10, 10, 8, 8]);
  });
});
