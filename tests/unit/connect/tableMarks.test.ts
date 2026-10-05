import { describe, expect, it } from 'vitest';
import { migrateForkSettings } from '../../../src/connect/migrateForkSettings';
import { FORK_TABLE_KEY_STORAGE } from '../../../src/connect/migrateLocalStores';
import { newTableKey } from '../../../src/connect/newTableKey';
import { ConnectSettingsStore, TABLE_KEY_STORAGE } from '../../../src/connect/settingsStore';
import { RETIRED_TABLE_LIMIT, readTableMarks, retired } from '../../../src/connect/tableMarks';
import { ensureTableIdentity } from '../../../src/app/online/sharing/identity/tableKey';
import { memoryKeyValueStore } from '../../../src/app/online/sharing/identity/deviceKeys';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { nodeIdentityCrypto } from '../online/sharing/sharingFixtures';
import { fakeDataPlugin } from './fakeDataPlugin';

const FORK_SETTINGS = 'atlas-vtt/.atlas-data/settings.json';
const OLD = { id: 'o'.repeat(43), publicKey: 'old-key', privateKey: { kty: 'EC', crv: 'P-256', d: 'old-secret', x: 'x', y: 'y' } };

/** A device: Connect's store over `data` (the synced data.json) and its own local storage, beside the preview's settings file. */
async function device(data: unknown, local = memoryKeyValueStore()): Promise<{ store: ConnectSettingsStore; plugin: ReturnType<typeof fakeDataPlugin>; local: typeof local }> {
  const plugin = fakeDataPlugin(data);
  const store = await ConnectSettingsStore.load(plugin, local);
  const { app } = createInMemoryApp({ files: { [FORK_SETTINGS]: JSON.stringify({ online: { table: OLD } }) } });
  await migrateForkSettings({ adapter: app.vault.adapter, settings: store, rereadDelayMs: 0 });
  await store.flush();
  return { store, plugin, local };
}
const synced = (plugin: { saved: unknown[] }): unknown => plugin.saved.at(-1);

describe('synced table key marks', () => {
  it("lets only the first device take the preview's settings-file key; a second one makes its own table", async () => {
    const first = await device(null);
    expect(first.store.get().table).toEqual(OLD);
    expect(synced(first.plugin)).toMatchObject({ forkTableKeyTaken: OLD.id });
    expect(JSON.stringify(first.plugin.saved)).not.toContain(OLD.privateKey.d);
    // The data.json synced elsewhere, before the settings step was marked there: the mark still stops it.
    const { forkSteps: _steps, migratedFromFork: _migrated, ...marksOnly } = synced(first.plugin) as Record<string, unknown>;
    const second = await device(marksOnly);
    expect(second.store.get().table).toBeNull();
    const own = await ensureTableIdentity(second.store, nodeIdentityCrypto);
    expect(own.id).not.toBe(OLD.id);
    expect(second.local.get(TABLE_KEY_STORAGE)).toMatchObject({ id: own.id });
  });

  it("after New table key, an empty device never gets the old key, from the preview's file, its local key or data.json", async () => {
    const first = await device(null);
    expect(await newTableKey({ settings: first.store, crypto: nodeIdentityCrypto, isHosting: () => false, confirm: async () => true, notify: () => undefined })).toBe('made');
    await first.store.flush();
    const data = synced(first.plugin) as Record<string, unknown>;
    expect(data).toMatchObject({ retiredTableIds: [OLD.id] });
    // No taken mark (as if it never synced), the old key in the preview's file, its local storage and an old data.json.
    const { forkTableKeyTaken: _taken, forkSteps: _steps, migratedFromFork: _migrated, ...retiredOnly } = data;
    const local = memoryKeyValueStore();
    local.set(FORK_TABLE_KEY_STORAGE, OLD);
    const empty = await device({ ...retiredOnly, online: { table: OLD } }, local);
    expect(empty.store.get().table).toBeNull();
    expect(empty.local.get(TABLE_KEY_STORAGE)).toBeNull();
    expect(JSON.stringify(empty.plugin.saved)).not.toContain(OLD.privateKey.d);
    // A device that still holds the old key locally does not use it either.
    const stale = memoryKeyValueStore();
    stale.set(TABLE_KEY_STORAGE, OLD);
    expect((await ConnectSettingsStore.load(fakeDataPlugin(retiredOnly), stale)).get().table).toBeNull();
  });

  it(`keeps the last ${RETIRED_TABLE_LIMIT} retired tables`, async () => {
    const { store, plugin } = await device(null);
    for (let i = 0; i < RETIRED_TABLE_LIMIT + 5; i++) {
      await newTableKey({ settings: store, crypto: nodeIdentityCrypto, isHosting: () => false, confirm: async () => true, notify: () => undefined });
    }
    await store.flush();
    const ids = (synced(plugin) as { retiredTableIds: string[] }).retiredTableIds;
    expect(ids).toHaveLength(RETIRED_TABLE_LIMIT);
    expect(ids).not.toContain(OLD.id);
    expect(ids).not.toContain(store.get().table!.id);
    expect(retired(Array.from({ length: 30 }, (_, i) => String(i).padStart(43, 'x')), OLD.id)).toHaveLength(RETIRED_TABLE_LIMIT);
    expect(readTableMarks({ retiredTableIds: [...Array.from({ length: 25 }, () => OLD.id), 'bad'], forkTableKeyTaken: 7 })).toEqual({
      forkTableKeyTaken: null, retiredTableIds: Array.from({ length: RETIRED_TABLE_LIMIT }, () => OLD.id),
    });
  });
});
