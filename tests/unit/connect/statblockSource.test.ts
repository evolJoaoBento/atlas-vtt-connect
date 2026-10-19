import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { Character } from '@atlas-vtt/api-types';
import { obsidianStatblocks } from '../../../src/connect/statblockSource';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

const template = (id: string, label: string): string => JSON.stringify({
  format: 'atlas-statblock-template', version: 1, id, fields: [{ key: 'pv', label, type: 'number' }], layout: { maxColumns: 1, blocks: [] },
});

function setup() {
  const { app } = createInMemoryApp({
    files: {
      'Adversaries/Modelo NPC.md': '',
      'atlas-vtt/statblock-templates/Adversario.atlastemplate': template('adv-1', 'PV'),
      'zzz/Copy.atlastemplate': template('adv-1', 'Later copy'),
      'broken.atlastemplate': '{ not json',
      'odd.atlastemplate': JSON.stringify({ format: 'atlas-statblock-template', version: 1, id: 'odd-1', layout: 'none' }),
    },
  });
  vi.mocked(app.metadataCache.getFileCache).mockImplementation((file) => (file.path === 'Adversaries/Modelo NPC.md'
    ? { frontmatter: { statblock: true, 'atlas-template': 'adv-1', pv: 6 } }
    : null));
  const token = { kind: 'character', statblockPath: 'Adversaries/Modelo NPC.md' } as unknown as Character;
  return { app, token, source: obsidianStatblocks(app) };
}

describe('the stat block a token links', () => {
  afterEach(() => {
    delete (window as { FantasyStatblocks?: unknown }).FantasyStatblocks;
    vi.useRealTimers();
  });

  it("reads a templated note with its vault template, before Fantasy Statblocks' copy of it, and tells once templates are read", async () => {
    vi.useFakeTimers();
    (window as { FantasyStatblocks?: unknown }).FantasyStatblocks = {
      isResolved: () => true,
      getBestiaryCreatures: () => [{ path: 'Adversaries/Modelo NPC.md', name: 'Modelo NPC' }],
    };
    const { app, source, token } = setup();
    const listener = vi.fn();
    const stop = source.onChange(listener);
    // Not read yet: no template, and not "missing" either.
    expect(source.read(token)).toMatchObject({ atlasTemplate: 'adv-1', template: undefined, fields: { name: 'Modelo NPC', pv: 6 } });
    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalledTimes(1);
    // The lowest path wins where two files share an id; a file that is no JSON is left out.
    expect(source.read(token)).toMatchObject({ template: { id: 'adv-1', fields: [{ label: 'PV' }] } });
    // A file claiming an id that is no template this reads: never "missing", which would show every field.
    vi.mocked(app.metadataCache.getFileCache).mockReturnValue({ frontmatter: { statblock: true, 'atlas-template': 'odd-1' } });
    expect(source.read(token)).toMatchObject({ atlasTemplate: 'odd-1', template: undefined });
    vi.mocked(app.metadataCache.getFileCache).mockReturnValue({ frontmatter: { statblock: true, 'atlas-template': 'gone-1' } });
    expect(source.read(token)).toMatchObject({ atlasTemplate: 'gone-1', template: null });
    stop();
  });

  it('reads the templates again when a template file changes', async () => {
    vi.useFakeTimers();
    const { app, source, token } = setup();
    const listener = vi.fn();
    source.onChange(listener);
    source.read(token);
    await vi.runAllTimersAsync();
    const calls = vi.mocked(app.vault.on).mock.calls as unknown as Array<[string, (file: unknown) => void]>;
    const onModify = calls.find(([name]) => name === 'modify')?.[1];
    expect(onModify).toBeDefined();
    vi.mocked(app.vault.cachedRead).mockImplementation(async (file: TFile) => (file.path.endsWith('Adversario.atlastemplate') ? template('adv-1', 'Pontos de vida') : ''));
    onModify!(new (TFile as unknown as new (path: string) => TFile)('atlas-vtt/statblock-templates/Adversario.atlastemplate'));
    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(source.read(token)).toMatchObject({ template: { fields: [{ label: 'Pontos de vida' }] } });
  });
});
