import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkedCreatures } from '../../../packages/atlas-host/src/sheets/linkedCreature';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const FENCE = 'Intro\n```statblock\nname: Fenced Goblin\nac: 15\nhp: 7\n```\n';

function setup(frontmatter: Record<string, Record<string, unknown>>) {
  const { app } = createInMemoryApp({
    files: {
      'Bestiary/Goblin.md': FENCE,
      'Bestiary/Plain.md': 'No stat block here.',
      'Bestiary/Templated.md': '',
      'Templates/Adv.atlastemplate': JSON.stringify({ format: 'atlas-statblock-template', version: 1, id: 'adv-1', fields: [], layout: { blocks: [] } }),
    },
  });
  vi.mocked(app.metadataCache.getFileCache).mockImplementation((file) => {
    const found = frontmatter[file.path];
    return found ? { frontmatter: found } : null;
  });
  return { app, linked: linkedCreatures(app) };
}

describe("the shared reader of a token's linked stat block", () => {
  afterEach(() => {
    delete (window as { FantasyStatblocks?: unknown }).FantasyStatblocks;
  });

  it("reads a note's statblock fence with its frontmatter laid over it, where the caches alone see no stat block", async () => {
    const { linked } = setup({ 'Bestiary/Goblin.md': { hp: 9 } });
    const token = { statblockPath: 'Bestiary/Goblin.md#Goblin' };
    // From the caches: the frontmatter says nothing of a stat block, so none (as Connect's player sheets read it).
    expect(linked.read(token)).toBeNull();
    expect(await linked.readNote(token)).toEqual({ name: 'Fenced Goblin', ac: 15, hp: 9 });
    expect(await linked.noteFields('Bestiary/Goblin.md')).toEqual({ name: 'Fenced Goblin', ac: 15, hp: 9 });
    expect(await linked.readNote({ statblockPath: 'Bestiary/Plain.md' })).toBeNull();
    expect(await linked.noteFields('Bestiary/Plain.md')).toBeNull();
  });

  it('waits for the vault templates before it reads a templated note', async () => {
    const { linked } = setup({ 'Bestiary/Templated.md': { 'atlas-template': 'adv-1', pv: 3 } });
    const found = await linked.readNote({ statblockPath: 'Bestiary/Templated.md' });
    expect(found).toMatchObject({ atlasTemplate: 'adv-1', template: { id: 'adv-1' }, fields: { name: 'Templated', pv: 3 } });
  });

  it('takes the bestiary entry of the note first, then the creature of the name, and none where Fantasy Statblocks throws', async () => {
    const { linked } = setup({});
    (window as { FantasyStatblocks?: unknown }).FantasyStatblocks = {
      isResolved: () => true,
      getBestiaryCreatures: () => [{ path: 'Bestiary/Goblin.md', name: 'Bestiary Goblin' }],
      hasCreature: (name: string) => name === 'Orc',
      getCreatureFromBestiary: () => ({ name: 'Orc' }),
    };
    expect(await linked.readNote({ statblockPath: 'Bestiary/Goblin.md' })).toEqual({ path: 'Bestiary/Goblin.md', name: 'Bestiary Goblin' });
    expect(linked.read({ statblockPath: 'Bestiary/Plain.md', statblockName: ' Orc ' })).toEqual({ name: 'Orc' });
    (window as { FantasyStatblocks?: unknown }).FantasyStatblocks = { isResolved: () => true, getBestiaryCreatures: () => { throw new Error('busy'); } };
    expect(linked.read({ statblockPath: 'Bestiary/Plain.md' })).toBeNull();
  });
});
