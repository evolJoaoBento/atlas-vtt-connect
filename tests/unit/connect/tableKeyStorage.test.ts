import { describe, expect, it } from 'vitest';
import { migrateForkSettings } from '../../../src/connect/migrateForkSettings';
import { ConnectSettingsStore, TABLE_KEY_STORAGE } from '../../../src/connect/settingsStore';
import { ensureTableIdentity } from '../../../src/app/online/sharing/identity/tableKey';
import { memoryKeyValueStore, type KeyValueStore } from '../../../src/app/online/sharing/identity/deviceKeys';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { nodeIdentityCrypto } from '../online/sharing/sharingFixtures';
import { fakeDataPlugin } from './fakeDataPlugin';

const TABLE = { id: 'a'.repeat(43), publicKey: 'public-key', privateKey: { kty: 'EC', crv: 'P-256', d: 'secret', x: 'x', y: 'y' } };
const OTHER = { id: 'b'.repeat(43), publicKey: 'other-key', privateKey: { kty: 'EC', crv: 'P-256', d: 'other', x: 'x', y: 'y' } };

/** What the last save put in data.json's `online`. */
const savedOnline = (plugin: { saved: unknown[] }): Record<string, unknown> => (plugin.saved.at(-1) as { online: Record<string, unknown> }).online;

/** A local storage that drops every write, as one that is full or blocked. */
const refusingStore = (): KeyValueStore => ({ get: () => null, set: () => {} });

describe('the table key lives in local storage on this device, never in data.json', () => {
  it('moves a key found in data.json to local storage and strips it from the file', async () => {
    const plugin = fakeDataPlugin({ online: { playerName: 'GM', table: TABLE } });
    const local = memoryKeyValueStore();
    const store = await ConnectSettingsStore.load(plugin, local);
    expect(store.get().table).toEqual(TABLE);
    expect(local.get(TABLE_KEY_STORAGE)).toEqual(TABLE);
    expect(savedOnline(plugin)).not.toHaveProperty('table');
    expect(savedOnline(plugin)).toMatchObject({ playerName: 'GM' });
    // Later saves keep it out.
    store.set({ playerName: 'Rin' });
    await store.flush();
    expect(savedOnline(plugin)).not.toHaveProperty('table');
    expect(JSON.stringify(plugin.saved)).not.toContain('"d":"secret"');
  });

  it('keeps the local copy when both exist, and strips the synced one', async () => {
    const plugin = fakeDataPlugin({ online: { table: OTHER } });
    const local = memoryKeyValueStore();
    local.set(TABLE_KEY_STORAGE, TABLE);
    const store = await ConnectSettingsStore.load(plugin, local);
    expect(store.get().table).toEqual(TABLE);
    expect(local.get(TABLE_KEY_STORAGE)).toEqual(TABLE);
    expect(savedOnline(plugin)).not.toHaveProperty('table');
  });

  it('a new table key goes to local storage only', async () => {
    const plugin = fakeDataPlugin(null);
    const local = memoryKeyValueStore();
    const store = await ConnectSettingsStore.load(plugin, local);
    const table = await ensureTableIdentity(store, nodeIdentityCrypto);
    await store.flush();
    expect(local.get(TABLE_KEY_STORAGE)).toMatchObject({ id: table.id, publicKey: table.keys.publicKey });
    expect(savedOnline(plugin)).not.toHaveProperty('table');
  });

  it('a second device with the synced data.json but no local key makes its own table and keys', async () => {
    const first = memoryKeyValueStore();
    const plugin = fakeDataPlugin({ online: { playerName: 'GM', table: TABLE } });
    await ConnectSettingsStore.load(plugin, first);
    const synced = plugin.saved.at(-1);
    const second = memoryKeyValueStore();
    const elsewhere = fakeDataPlugin(synced);
    const store = await ConnectSettingsStore.load(elsewhere, second);
    expect(store.get().table).toBeNull();
    expect(store.get().playerName).toBe('GM');
    const table = await ensureTableIdentity(store, nodeIdentityCrypto);
    expect(table.id).not.toBe(TABLE.id);
    expect(second.get(TABLE_KEY_STORAGE)).toMatchObject({ id: table.id });
    expect(first.get(TABLE_KEY_STORAGE)).toEqual(TABLE);
  });

  it('an interrupted move loses nothing: the file keeps the key until local storage holds it', async () => {
    // Local storage refuses the write: the key stays in data.json, in memory and in every save.
    const plugin = fakeDataPlugin({ online: { table: TABLE } });
    const refused = await ConnectSettingsStore.load(plugin, refusingStore());
    expect(refused.get().table).toEqual(TABLE);
    refused.set({ playerName: 'GM' });
    await refused.flush();
    expect(savedOnline(plugin).table).toEqual(TABLE);
    // Stopped after the local write and before the file was saved: the next start finds both, and strips the file.
    const local = memoryKeyValueStore();
    local.set(TABLE_KEY_STORAGE, TABLE);
    const resumed = fakeDataPlugin({ online: { table: TABLE } });
    const store = await ConnectSettingsStore.load(resumed, local);
    expect(store.get().table).toEqual(TABLE);
    expect(savedOnline(resumed)).not.toHaveProperty('table');
    // A save that fails leaves the file as it was; the key is still in local storage.
    const failing = { loadData: async () => ({ online: { table: TABLE } }), saveData: async () => { throw new Error('disk full'); } };
    const kept = memoryKeyValueStore();
    await ConnectSettingsStore.load(failing, kept);
    expect(kept.get(TABLE_KEY_STORAGE)).toEqual(TABLE);
  });

  it("the fork's table key, brought by the settings step, lands in local storage", async () => {
    const { app } = createInMemoryApp({ files: { 'atlas-vtt/.atlas-data/settings.json': JSON.stringify({ online: { playerName: 'GM', table: TABLE } }) } });
    const plugin = fakeDataPlugin(null);
    const local = memoryKeyValueStore();
    const settings = await ConnectSettingsStore.load(plugin, local);
    expect((await migrateForkSettings({ adapter: app.vault.adapter, settings, rereadDelayMs: 0 })).result).toBe('copied');
    await settings.flush();
    expect(local.get(TABLE_KEY_STORAGE)).toEqual(TABLE);
    expect(settings.get().table).toEqual(TABLE);
    expect(plugin.saved.length).toBeGreaterThan(0);
    for (const saved of plugin.saved) expect((saved as { online: object }).online).not.toHaveProperty('table');
  });
});
