import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { Json, SceneRecord, ScenesApi } from '@atlas-vtt/api-types';
import { migrateFromFork, MIGRATED_NOTICE, type MigrationDeps } from '../../../src/connect/migrateFromFork';
import { KEPT_FORK_COPY_NOTICE } from '../../../src/connect/migrateSharingFolder';
import { ConnectSettingsStore } from '../../../src/connect/settingsStore';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { fakeDataPlugin } from './fakeDataPlugin';

const STORAGE = 'atlas-vtt/.atlas-data/extensions/atlas-vtt-connect';
const FORK_SETTINGS = 'atlas-vtt/.atlas-data/settings.json';
const FORK = 'atlas-vtt/.atlas-data/sharing';
const OWN = `${STORAGE}/sharing`;
/** A table key of the shape the fork stores (`validStoredTable`). */
const TABLE = { id: 'a'.repeat(43), publicKey: 'public-key', privateKey: { kty: 'EC', crv: 'P-256', d: 'secret', x: 'x', y: 'y' } };

/** Atlas's scenes with this extension's data set on the scenes named in `shared`. */
function scenesWith(ids: string[], shared: string[] = []): Pick<ScenesApi, 'list' | 'getData'> {
  return {
    list: async () => ids.map((id) => ({ id, collectionId: 'c', name: id }) as unknown as SceneRecord),
    getData: async (id: string): Promise<Json | undefined> => (shared.includes(id) ? { audience: { kind: 'everyone' } } : undefined),
  };
}

function deps(app: App, settings: ConnectSettingsStore, scenes: MigrationDeps['scenes'] = scenesWith([])): MigrationDeps & { notices: string[] } {
  const notices: string[] = [];
  return { adapter: app.vault.adapter, settings, storageFolder: STORAGE, scenes, notify: (message) => { notices.push(message); }, notices };
}

/** The fork's sharing folder as the fork left it, with a note base and a merge history entry. */
const forkSharing: Record<string, string> = {
  [`${FORK}/people.json`]: '{"version":1,"people":[{"name":"Rin"}]}',
  [`${FORK}/items.json`]: '{"version":1,"notes":{}}',
  [`${FORK}/bases/n1.md`]: 'base text',
  [`${FORK}/history/h1.json`]: '{"entries":[]}',
};

const snapshot = (files: Map<string, string>, folder: string): Record<string, string> =>
  Object.fromEntries([...files].filter(([path]) => path.startsWith(`${folder}/`)));

describe('migrateFromFork', () => {
  it('copies the online settings once, moving the old default page to the new one and keeping a custom one', async () => {
    const { app } = createInMemoryApp({ files: { [FORK_SETTINGS]: JSON.stringify({ online: { playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt/', playerName: 'GM', table: TABLE } }) } });
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const report = await migrateFromFork(deps(app, settings));
    expect(report.settings).toBe('copied');
    expect(settings.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
    expect(settings.get().playerName).toBe('GM');
    expect(settings.get().table).toEqual(TABLE);
    expect(settings.migratedFromFork).toBe(true);
    expect(await app.vault.adapter.read(FORK_SETTINGS)).toContain('"online"'); // never written
    expect(app.vault.adapter.write).not.toHaveBeenCalledWith(FORK_SETTINGS, expect.anything());
    expect((await migrateFromFork(deps(app, settings))).settings).toBe('skipped');
  });

  it('moves the old default page without its trailing slash too', async () => {
    const { app } = createInMemoryApp({ files: { [FORK_SETTINGS]: JSON.stringify({ online: { playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt' } }) } });
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    await migrateFromFork(deps(app, settings));
    expect(settings.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
  });

  it('keeps a custom player page address', async () => {
    const { app } = createInMemoryApp({ files: { [FORK_SETTINGS]: JSON.stringify({ online: { playerPageUrl: 'https://my.host/' } }) } });
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    expect((await migrateFromFork(deps(app, settings))).settings).toBe('copied');
    expect(settings.get().playerPageUrl).toBe('https://my.host/');
  });

  it("leaves Connect's own settings alone when it already has them", async () => {
    const { app } = createInMemoryApp({ files: { [FORK_SETTINGS]: JSON.stringify({ online: { playerName: 'Fork' } }) } });
    const settings = await ConnectSettingsStore.load(fakeDataPlugin({ online: { playerName: 'Connect' } }));
    const run = deps(app, settings);
    expect((await migrateFromFork(run)).settings).toBe('skipped');
    expect(settings.get().playerName).toBe('Connect');
    expect(run.notices).toEqual([]);
    expect(settings.migratedFromFork).toBe(true);
  });

  it('reads settings of any shape tolerantly: nothing to copy is none, and is done', async () => {
    for (const text of ['{ not json', '"just a string"', JSON.stringify({ online: 'nope' }), JSON.stringify({ online: [1] }), JSON.stringify({ hotkeys: {} })]) {
      const { app } = createInMemoryApp({ files: { [FORK_SETTINGS]: text } });
      const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
      const run = deps(app, settings);
      expect((await migrateFromFork(run)).settings).toBe('none');
      expect(settings.hasOnline).toBe(false);
      expect(run.notices).toEqual([]);
    }
    const { app } = createInMemoryApp();
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    expect(await migrateFromFork(deps(app, settings))).toEqual({ settings: 'none', sharing: 'none', mapShares: 0 });
    expect(settings.migratedFromFork).toBe(true);
  });

  it('a settings file mid-rewrite (not JSON) is tried again next time rather than marked done', async () => {
    const { app, files } = createInMemoryApp({ files: { [FORK_SETTINGS]: '{"online": {"playerName": "G' } });
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    await migrateFromFork(deps(app, settings));
    expect(settings.migratedFromFork).toBe(false);
    files.set(FORK_SETTINGS, JSON.stringify({ online: { playerName: 'GM' } }));
    expect((await migrateFromFork(deps(app, settings))).settings).toBe('copied');
    expect(settings.migratedFromFork).toBe(true);
  });

  it('a settings file that cannot be read fails the run, which is not marked done', async () => {
    const { app } = createInMemoryApp({ files: { [FORK_SETTINGS]: JSON.stringify({ online: { playerName: 'GM' } }) } });
    vi.mocked(app.vault.adapter.read).mockRejectedValueOnce(new Error('EBUSY'));
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    await expect(migrateFromFork(deps(app, settings))).rejects.toThrow('EBUSY');
    expect(settings.migratedFromFork).toBe(false);
    expect((await migrateFromFork(deps(app, settings))).settings).toBe('copied');
  });

  it('moves the sharing folder, or merges into an existing one without overwriting', async () => {
    // Case 1: only the fork's folder. Everything arrives, verified; the fork's copy stays as it was.
    const first = createInMemoryApp({ files: { ...forkSharing } });
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const moved = deps(first.app, settings);
    expect((await migrateFromFork(moved)).sharing).toBe('moved');
    for (const [path, text] of Object.entries(forkSharing)) expect(first.files.get(path.replace(FORK, OWN))).toBe(text);
    expect(snapshot(first.files, FORK)).toEqual(forkSharing);
    expect(first.folders.has(`${OWN}.migrating`)).toBe(false);
    expect(moved.notices).toEqual([MIGRATED_NOTICE]);
    expect(settings.migratedFromFork).toBe(true);

    // Case 2: both. Connect's people.json is kept, items.json and the rest are copied, the fork's folder stays, a notice says so.
    const second = createInMemoryApp({ files: { ...forkSharing, [`${OWN}/people.json`]: '{"version":1,"people":[{"name":"Connect"}]}' } });
    const both = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const merged = deps(second.app, both);
    expect((await migrateFromFork(merged)).sharing).toBe('merged');
    expect(second.files.get(`${OWN}/people.json`)).toBe('{"version":1,"people":[{"name":"Connect"}]}');
    expect(second.files.get(`${OWN}/items.json`)).toBe(forkSharing[`${FORK}/items.json`]);
    expect(second.files.get(`${OWN}/bases/n1.md`)).toBe('base text');
    expect(second.files.get(`${OWN}/history/h1.json`)).toBe('{"entries":[]}');
    expect([...second.files.keys()].some((path) => path.endsWith('.migrating'))).toBe(false);
    expect(snapshot(second.files, FORK)).toEqual(forkSharing);
    expect(merged.notices).toEqual([KEPT_FORK_COPY_NOTICE, MIGRATED_NOTICE]);
    expect(KEPT_FORK_COPY_NOTICE).toBe("Atlas VTT Connect kept its sharing data and left the preview's copy in atlas-vtt/.atlas-data/sharing. Delete it once you've checked your people and shares.");
  });

  it('copies unreadable data files byte for byte: Connect keeps its own broken copy when it first reads them', async () => {
    const { app, files } = createInMemoryApp({ files: { [`${FORK}/people.json`]: '{{ garbage' } });
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    await migrateFromFork(deps(app, settings));
    expect(files.get(`${OWN}/people.json`)).toBe('{{ garbage');
  });

  it('an interrupted run (rename throws) is not marked done and finishes next time', async () => {
    const { app, files } = createInMemoryApp({ files: { ...forkSharing } });
    vi.mocked(app.vault.adapter.rename).mockRejectedValueOnce(new Error('Obsidian closed'));
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const interrupted = deps(app, settings);
    await expect(migrateFromFork(interrupted)).rejects.toThrow('Obsidian closed');
    expect(settings.migratedFromFork).toBe(false);
    expect(interrupted.notices).toEqual([]);
    // Nothing half-made where Connect reads: the copy waits in the staging folder.
    expect(await app.vault.adapter.exists(OWN)).toBe(false);
    const rerun = deps(app, settings);
    expect((await migrateFromFork(rerun)).sharing).toBe('moved');
    expect(settings.migratedFromFork).toBe(true);
    expect(files.get(`${OWN}/people.json`)).toBe(forkSharing[`${FORK}/people.json`]);
    expect(snapshot(files, FORK)).toEqual(forkSharing);
    expect(rerun.notices).toEqual([MIGRATED_NOTICE]);
  });

  it('a write that fails part way is not marked done, and the next run completes the copy', async () => {
    const { app, files } = createInMemoryApp({ files: { ...forkSharing, [`${OWN}/people.json`]: 'own' } });
    const writeBinary = vi.mocked(app.vault.adapter.writeBinary);
    const original = writeBinary.getMockImplementation()!;
    writeBinary.mockImplementationOnce(original).mockRejectedValueOnce(new Error('disk full'));
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    await expect(migrateFromFork(deps(app, settings))).rejects.toThrow('disk full');
    expect(settings.migratedFromFork).toBe(false);
    expect((await migrateFromFork(deps(app, settings))).sharing).toBe('merged');
    expect(files.get(`${OWN}/people.json`)).toBe('own');
    for (const name of ['items.json', 'bases/n1.md', 'history/h1.json']) expect(files.get(`${OWN}/${name}`)).toBe(forkSharing[`${FORK}/${name}`]);
    expect(settings.migratedFromFork).toBe(true);
  });

  it('a copy that does not read back the same is never put in place', async () => {
    const { app, files } = createInMemoryApp({ files: { ...forkSharing } });
    vi.mocked(app.vault.adapter.readBinary).mockImplementation(async (path: string) => new TextEncoder().encode(path.includes('.migrating') ? 'torn' : files.get(path) ?? '').buffer as ArrayBuffer);
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    await expect(migrateFromFork(deps(app, settings))).rejects.toThrow('did not copy intact');
    expect(await app.vault.adapter.exists(OWN)).toBe(false);
    expect(settings.migratedFromFork).toBe(false);
  });

  it('without the scenes capability it waits for a newer Atlas before marking done', async () => {
    const { app } = createInMemoryApp({ files: { ...forkSharing, [FORK_SETTINGS]: JSON.stringify({ online: { playerName: 'GM' } }) } });
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const first = deps(app, settings, null);
    expect(await migrateFromFork(first)).toEqual({ settings: 'copied', sharing: 'moved', mapShares: 0 });
    expect(settings.migratedFromFork).toBe(false);
    expect(first.notices).toEqual([MIGRATED_NOTICE]);
    // The next start finds everything there already: nothing copied, no notice, still waiting for scenes.
    const again = deps(app, settings, null);
    expect(await migrateFromFork(again)).toEqual({ settings: 'skipped', sharing: 'none', mapShares: 0 });
    expect(again.notices).toEqual([]);
    expect(settings.migratedFromFork).toBe(false);
    // An Atlas with scenes (it moved the map shares when it loaded the index): counted, and done.
    const newer = deps(app, settings, scenesWith(['s1', 's2', 's3'], ['s1', 's3']));
    expect(await migrateFromFork(newer)).toEqual({ settings: 'skipped', sharing: 'none', mapShares: 2 });
    expect(newer.notices).toEqual([]);
    expect(settings.migratedFromFork).toBe(true);
  });

  it('counts map shares tolerantly: a scene whose data cannot be read is not counted, a list that fails waits', async () => {
    const { app } = createInMemoryApp();
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const scenes = scenesWith(['s1', 's2'], ['s1', 's2']);
    const getData = scenes.getData;
    scenes.getData = (id) => (id === 's2' ? Promise.reject(new Error('gone')) : getData(id));
    expect((await migrateFromFork(deps(app, settings, scenes))).mapShares).toBe(1);
    const failing = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const listFails = { ...scenes, list: () => Promise.reject(new Error('index not loaded')) };
    expect((await migrateFromFork(deps(app, failing, listFails))).mapShares).toBe(0);
    expect(failing.migratedFromFork).toBe(false);
  });
});
