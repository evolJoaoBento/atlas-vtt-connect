import { describe, expect, it } from 'vitest';
import { isTokenSheets, sheetRollFormula } from '../../../src/app/online/tools/sheets';
import { buildPlayerSheet, buildTemplateSheet, buildUntemplatedSheet, templateId } from '../../../src/app/online/tools/templateSheets';

/** A Daggerheart-like adversary template a GM made in Atlas (issue #9), its labels renamed into Portuguese. */
const ADVERSARY = {
  format: 'atlas-statblock-template',
  version: 1,
  id: 'adversario-k3j9x2',
  fields: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'image', label: 'Token art', type: 'image' },
    { key: 'patamar', label: 'Patamar', type: 'number', meaning: 'rating' },
    { key: 'pv', label: 'PV', type: 'number', meaning: 'hit-points' },
    { key: 'description', label: 'Description', type: 'markdown', meaning: 'description' },
    { key: 'motives_tactics', label: 'Motives & Tactics', type: 'number', formerKeys: ['motives'] },
    { key: 'difficulty', label: 'Difficulty', type: 'number' },
    { key: 'major', label: 'Major', type: 'number' },
    { key: 'severe', label: 'Severe', type: 'number' },
    { key: 'atk', label: 'ATK', type: 'number' },
    { key: 'attack', label: 'Attack', type: 'text' },
    { key: 'damage', label: 'Damage', type: 'dice' },
    { key: 'experience', label: 'Experience', type: 'list' },
    { key: 'features', label: 'Features', type: 'entries', entry: { textKey: 'text', extras: [{ key: 'kind', label: 'Kind', type: 'text' }] } },
    { key: 'secret', label: 'Secret', type: 'text' },
    { key: 'fadiga', label: 'Fadiga', type: 'number' },
  ],
  header: { hidden: ['type'] },
  layout: {
    maxColumns: 1,
    blocks: [
      { id: 'a0000001', type: 'stat', field: 'motives_tactics', look: 'run-in', display: 'signed' },
      { id: 'a0000002', type: 'divider' },
      {
        id: 'a0000003', type: 'row', blocks: [
          { id: 'a0000004', type: 'stat', field: 'difficulty', look: 'run-in' },
          { id: 'a0000005', type: 'metric', heading: 'Thresholds', fields: ['major', 'severe'] },
        ],
      },
      { id: 'a0000006', type: 'stat', field: 'atk', look: 'run-in', display: 'signed' },
      { id: 'a0000007', type: 'stat', field: 'attack', look: 'run-in', rollFrom: 'damage' },
      { id: 'a0000008', type: 'tags', field: 'experience', look: 'comma' },
      { id: 'a0000009', type: 'track', field: 'fadiga', look: 'boxes', counts: 'up', resource: 'fadiga' },
      { id: 'a0000010', type: 'stat', field: 'secret', look: 'run-in', showWhen: { field: 'difficulty', is: 'above', value: 99 } },
      { id: 'a0000011', type: 'entries', field: 'features', heading: 'Features' },
      { id: 'a0000012', type: 'script', summary: 'x', fs: {} },
      { id: 'a0000013', type: 'image', field: 'image', shape: 'token' },
      { id: 'a0000014', type: 'stat', field: 'notes', look: 'run-in' },
    ],
  },
};

const NOTE = {
  name: 'Modelo NPC', statblock: true, 'atlas-template': 'adversario-k3j9x2', image: 'secret/art.png', type: 'Solo',
  patamar: 1, pv: 6, description: 'A shadow in the mist.', motives: 2, difficulty: 12, major: 8, severe: 15, atk: 1, attack: 'Claws', damage: '1d6+2',
  experience: ['Ambush +2'], features: [{ name: 'teste', text: 'Roll +2 to hide.', kind: 'Passive' }], secret: 'GM only: a spy', fadiga: 1,
  notes: 'GM notes: not in the template',
};

describe("a player's sheet of a templated stat block", () => {
  it('lays the note out as its template does, with labels, signs, units and rolls', () => {
    const sheet = buildTemplateSheet(ADVERSARY, NOTE)!;
    expect(sheet.name).toBe('Modelo NPC');
    // The type is hidden by the template's header.
    expect(sheet.subtitle).toBe('Patamar 1');
    expect(sheet.sections).toEqual([
      {
        title: '', items: [
          { name: 'PV', desc: '6' },
          { name: '', desc: 'A shadow in the mist.' },
          { name: 'Motives & Tactics', desc: '+2' },
          { name: 'Difficulty', desc: '12' },
          { name: 'Thresholds', desc: 'Major 8 | Severe 15' },
          { name: 'ATK', desc: '+1' },
          { name: 'Attack', desc: 'Claws (1d6+2)' },
          { name: 'Experience', desc: 'Ambush +2' },
        ],
      },
      { title: 'Features', items: [{ name: 'teste', desc: '(Kind: Passive) Roll +2 to hide.' }] },
    ]);
    expect(isTokenSheets([{ tokenId: 't', name: 'Modelo NPC', resources: [], sheet }])).toBe(true);
    // Rolls are found by where they are and what they say, as in any sheet.
    expect(sheetRollFormula(sheet, { kind: 'text', section: 0, item: 2, index: 0, text: '+2' })).toBe('+2');
    expect(sheetRollFormula(sheet, { kind: 'text', section: 0, item: 6, index: 0, text: '1d6+2' })).toBe('1d6+2');
    expect(sheetRollFormula(sheet, { kind: 'text', section: 1, item: 0, index: 0, text: '+2' })).toBe('+2');
  });

  it('never sends what the template does not show: other keys, images, hidden blocks', () => {
    const json = JSON.stringify(buildTemplateSheet(ADVERSARY, NOTE));
    for (const secret of ['GM notes', 'GM only', 'secret/art.png', 'Solo', 'adversario', 'Fadiga']) expect(json).not.toContain(secret);
  });

  it("shows a track's number only where no token resource carries it", () => {
    const blocks = [{ id: 'e1', type: 'track', field: 'fadiga', look: 'boxes', counts: 'up' }];
    const sheet = buildTemplateSheet({ ...ADVERSARY, header: { hidden: ['hp', 'description', 'level'] }, layout: { maxColumns: 1, blocks } }, NOTE)!;
    expect(sheet.sections).toEqual([{ title: '', items: [{ name: 'Fadiga', desc: '1' }] }]);
  });

  it('keeps every text to the limits a page checks', () => {
    const long = 'x'.repeat(5000);
    const template = {
      ...ADVERSARY,
      fields: [...ADVERSARY.fields, { key: 'big', label: 'L'.repeat(300), type: 'text' }],
      layout: { maxColumns: 1, blocks: [
        { id: 'b1', type: 'section', heading: 'H'.repeat(300), blocks: [{ id: 'b2', type: 'stat', field: 'big', look: 'run-in' }] },
        ...Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, type: 'heading', text: `Part ${index}`, level: 'section' })),
        ...Array.from({ length: 20 }, (_, index) => ({ id: `d${index}`, type: 'text', text: `Line ${index}` })),
      ] },
    };
    const sheet = buildTemplateSheet(template, { ...NOTE, big: long })!;
    expect(isTokenSheets([{ tokenId: 't', name: 'x', resources: [], sheet }])).toBe(true);
  });

  it('shows every field of a note whose template is not in the vault, and only the name while templates are read', () => {
    const missing = buildPlayerSheet({ atlasTemplate: 'gone-abc123', template: null, fields: NOTE })!;
    expect(missing.sections[0]?.items).toContainEqual({ name: 'Motives', desc: '2' });
    expect(missing.sections.at(-1)).toEqual({ title: 'Features', items: [{ name: 'teste', desc: 'Roll +2 to hide.' }] });
    expect(JSON.stringify(missing)).not.toContain('secret/art.png');
    expect(buildUntemplatedSheet({ name: 'X', statblock: true })?.sections).toEqual([]);
    expect(buildPlayerSheet({ atlasTemplate: 'adversario-k3j9x2', template: undefined, fields: NOTE })).toMatchObject({ name: 'Modelo NPC', sections: [] });
  });

  it("reads a built-in template's stat block as a 5e one, and a Fantasy Statblocks creature as before", () => {
    const builtIn = buildPlayerSheet({ atlasTemplate: 'builtin:generic-creature', template: null, fields: { name: 'Wolf', ac: 13, hp: 11 } })!;
    expect(builtIn).toMatchObject({ name: 'Wolf', ac: '13', hp: '11' });
    expect(buildPlayerSheet({ name: 'Goblin', ac: 15 })).toMatchObject({ name: 'Goblin', ac: '15' });
  });

  it('takes only files Atlas would read as templates', () => {
    expect(templateId(ADVERSARY)).toBe('adversario-k3j9x2');
    expect(templateId({ ...ADVERSARY, format: 'other' })).toBeNull();
    expect(templateId({ ...ADVERSARY, layout: null })).toBeNull();
  });
});
