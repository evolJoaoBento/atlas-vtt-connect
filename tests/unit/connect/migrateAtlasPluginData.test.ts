import { describe, expect, it } from 'vitest';
import { migrateFromFork } from '../../../src/connect/migrateFromFork';
import { atlasPluginDataFile, FORK_SETTINGS_FILE, migrateForkSettings } from '../../../src/connect/migrateForkSettings';
import { ConnectSettingsStore } from '../../../src/connect/settingsStore';
import { failureNotice } from '../../../src/connect/startMigration';
import { memoryKeyValueStore } from '../../../src/app/online/sharing/identity/deviceKeys';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { fakeDataPlugin } from './fakeDataPlugin';

// Final review I2: from 0.6 the fork keeps `online` in Atlas's plugin data and leaves the old settings file behind,
// frozen. The plugin data is read first; the old file only when the plugin data has no `online` record.

const DATA = atlasPluginDataFile('.obsidian');
const TABLE = { id: 't'.repeat(43), publicKey: 'public-key', privateKey: { kty: 'EC', crv: 'P-256', d: 'secret', x: 'x', y: 'y' } };

async function run(files: Record<string, string>, data: unknown = null): Promise<{ store: ConnectSettingsStore; step: Awaited<ReturnType<typeof migrateForkSettings>> }> {
  const { app } = createInMemoryApp({ files });
  const store = await ConnectSettingsStore.load(fakeDataPlugin(data), memoryKeyValueStore());
  const step = await migrateForkSettings({ adapter: app.vault.adapter, configDir: app.vault.configDir, settings: store, rereadDelayMs: 0 });
  return { store, step };
}

describe("migration from the fork's 0.6 plugin data", () => {
  it('names the plugin data in the configuration folder', () => {
    expect(DATA).toBe('.obsidian/plugins/atlas-vtt/data.json');
    expect(atlasPluginDataFile('.config')).toBe('.config/plugins/atlas-vtt/data.json');
  });

  it("takes the plugin data's online settings over a stale settings.json, whole (none of the old file's fields fill in)", async () => {
    const { store, step } = await run({
      [DATA]: JSON.stringify({ hotkeys: {}, online: { playerName: 'Current', signaling: { mode: 'custom', host: 'new.example', port: 9000, path: '/', key: 'k', secure: true } } }),
      [FORK_SETTINGS_FILE]: JSON.stringify({ online: { playerName: 'Stale', logEvents: true, signaling: { mode: 'custom', host: 'old.example', port: 9000, path: '/', key: 'k', secure: true } } }),
    });
    expect(step).toEqual({ result: 'copied', done: true });
    expect(store.get()).toMatchObject({ playerName: 'Current', logEvents: false, signaling: { host: 'new.example' } });
  });

  it('works on a vault that started on 0.6, with only the plugin data, its table key taken by the first device', async () => {
    const { store, step } = await run({ [DATA]: JSON.stringify({ online: { playerName: 'GM', table: TABLE, playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt/' } }) });
    expect(step.result).toBe('copied');
    expect(store.get()).toMatchObject({ playerName: 'GM', table: TABLE, playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt-connect/' });
    expect(store.takeKeyMoved()).toBe(true);
    // A second device, whose synced Connect data says the key was taken, makes its own table.
    const second = await run({ [DATA]: JSON.stringify({ online: { table: TABLE } }) }, { forkTableKeyTaken: TABLE.id });
    expect(second.store.get().table).toBeNull();
    // A retired table is never taken from the plugin data either.
    const retired = await run({ [DATA]: JSON.stringify({ online: { table: TABLE } }) }, { retiredTableIds: [TABLE.id] });
    expect(retired.store.get().table).toBeNull();
  });

  it('falls back to settings.json when the plugin data has no online record', async () => {
    for (const data of [JSON.stringify({ hotkeys: {} }), JSON.stringify({ online: 'nope' }), null]) {
      const files: Record<string, string> = { [FORK_SETTINGS_FILE]: JSON.stringify({ online: { playerName: 'Old' } }) };
      if (data !== null) files[DATA] = data;
      const { store, step } = await run(files);
      expect(step.result).toBe('copied');
      expect(store.get().playerName).toBe('Old');
    }
  });

  it('a plugin data file that is not JSON leaves the step to do and never falls back to the stale file', async () => {
    const { store, step } = await run({ [DATA]: '{"online": {"playerName": "G', [FORK_SETTINGS_FILE]: JSON.stringify({ online: { playerName: 'Stale' } }) });
    expect(step).toEqual({ result: 'none', done: false, unreadable: DATA });
    expect(store.forkStepDone('settings')).toBe(false);
    expect(store.get().playerName).toBe('');
    expect(failureNotice('settings', step.unreadable)).toContain(`Check that ${DATA} is whole`);
    expect(failureNotice('settings')).toContain(`Check that ${FORK_SETTINGS_FILE} is whole`);
  });

  it('the whole migration reports which file was not whole', async () => {
    const { app } = createInMemoryApp({ files: { [DATA]: '{ not json' } });
    const settings = await ConnectSettingsStore.load(fakeDataPlugin(null), memoryKeyValueStore());
    const report = await migrateFromFork({
      adapter: app.vault.adapter, configDir: app.vault.configDir, settings, storageFolder: 'atlas-vtt/.atlas-data/extensions/atlas-vtt-connect',
      scenes: null, notify: () => undefined, rereadDelayMs: 0,
    });
    expect(report.unreadable).toBe(DATA);
    expect(settings.forkStepDone('settings')).toBe(false);
  });
});
