import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { DEVICE_KEYS_STORAGE } from '../../../src/app/online/sharing/identity/deviceKeys';
import { MIGRATED_NOTICE } from '../../../src/connect/migrateFromFork';
import { FORK_DEVICE_KEYS_STORAGE, type ImageCacheDeps } from '../../../src/connect/migrateLocalStores';
import { ConnectSettingsStore } from '../../../src/connect/settingsStore';
import { MIGRATION_FAILED_NOTICE, startMigration } from '../../../src/connect/startMigration';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { fakeDataPlugin } from './fakeDataPlugin';
import { connected, HOSTING } from './hostingFixtures';

const FORK_PEOPLE = 'atlas-vtt/.atlas-data/sharing/people.json';
const OWN_PEOPLE = 'atlas-vtt/.atlas-data/extensions/atlas-vtt-connect/sharing/people.json';
const PEOPLE = JSON.stringify({ version: 1, people: [], retiredNames: [], placeholders: [] });
const WITH_SCENES: AtlasCapability[] = [...HOSTING, 'scenes'];
const KEYS = { publicKey: 'public', privateKey: { kty: 'EC', crv: 'P-256', d: 'd', x: 'x', y: 'y' } };
const noImages: ImageCacheDeps = { exists: async () => false, open: async () => null };

describe('the fork migration when Connect binds to Atlas', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

  it('brings the fork data over before hosting starts, once', async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const notices: string[] = [];
    const { connect, files, atlas, fire } = connected(WITH_SCENES, undefined, undefined, {
      files: { [FORK_PEOPLE]: PEOPLE },
      options: { migration: store, migrationStart: { notify: (message) => { notices.push(message); }, images: noImages } },
    });
    // Hosting has not started while the copy runs.
    expect(connect.commands.has('start-online-session')).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(files.get(OWN_PEOPLE)).toBe(PEOPLE);
    expect(connect.commands.has('start-online-session')).toBe(true);
    expect(store.migratedFromFork).toBe(true);
    expect(notices).toEqual([MIGRATED_NOTICE]);
    // An Atlas reload binds again: nothing runs twice.
    atlas.unload();
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '1.8.0', capabilities: WITH_SCENES }));
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toEqual([MIGRATED_NOTICE]);
    expect(connect.commands.has('start-online-session')).toBe(true);
  });

  it('a failed run keeps hosting off for this binding and says so; the next binding tries again', async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const notices: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let answer = (): void => undefined;
    const { connect, files, atlas, fire } = connected(WITH_SCENES, new Promise<void>((resolve) => { answer = resolve; }), undefined, {
      files: { [FORK_PEOPLE]: PEOPLE },
      options: { migration: store, migrationStart: { notify: (message) => { notices.push(message); }, images: noImages } },
    });
    vi.mocked(connect.plugin.app.vault.adapter.rename).mockRejectedValueOnce(new Error('Obsidian closed'));
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toEqual([MIGRATION_FAILED_NOTICE]);
    expect(error).toHaveBeenCalled();
    expect(connect.commands.has('start-online-session')).toBe(false);
    expect(files.has(OWN_PEOPLE)).toBe(false);
    expect(store.migratedFromFork).toBe(false);
    atlas.unload();
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '1.8.0', capabilities: WITH_SCENES }));
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toEqual([MIGRATION_FAILED_NOTICE, MIGRATED_NOTICE]);
    expect(files.get(OWN_PEOPLE)).toBe(PEOPLE);
    expect(connect.commands.has('start-online-session')).toBe(true);
    expect(store.migratedFromFork).toBe(true);
    error.mockRestore();
  });

  it('copies the device keys before joining starts, and runs one migration at a time', async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const local = new Map<string, unknown>([[FORK_DEVICE_KEYS_STORAGE, { 'table-a': KEYS }]]);
    const { connect } = connected(['storage']);
    Object.assign(connect.plugin.app, { loadLocalStorage: (key: string) => local.get(key) ?? null, saveLocalStorage: (key: string, value: unknown) => { local.set(key, value); } });
    const atlas = new FakeAtlas({ version: '1.6.0', capabilities: ['storage'] });
    const extension = atlas.connect(connect.plugin);
    const first = startMigration(connect.plugin.app, atlas, extension, store, { notify: () => undefined, images: noImages });
    expect(local.get(DEVICE_KEYS_STORAGE)).toEqual({ 'table-a': KEYS });
    expect(startMigration(connect.plugin.app, atlas, extension, store, { notify: () => undefined, images: noImages })).toBe(first);
    expect(await first).toBe(true);
    // Without scenes Atlas has not moved the map shares: not marked, so the next start runs again.
    expect(store.migratedFromFork).toBe(false);
    expect(await startMigration(connect.plugin.app, atlas, extension, undefined)).toBe(true);
  });

  it('copies the kept images only while keeping images is on', async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin(null));
    const { connect } = connected(['storage']);
    const atlas = new FakeAtlas({ version: '1.6.0', capabilities: ['storage'] });
    const extension = atlas.connect(connect.plugin);
    const exists = vi.fn(async () => false);
    await startMigration(connect.plugin.app, atlas, extension, store, { notify: () => undefined, images: { exists, open: async () => null } });
    expect(exists).toHaveBeenCalledTimes(1);
    store.set({ keepImages: false });
    await startMigration(connect.plugin.app, atlas, extension, store, { notify: () => undefined, images: { exists, open: async () => null } });
    expect(exists).toHaveBeenCalledTimes(1);
  });
});
