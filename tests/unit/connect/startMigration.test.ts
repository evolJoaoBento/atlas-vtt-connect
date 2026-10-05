import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { DEVICE_KEYS_STORAGE, memoryKeyValueStore } from '../../../src/app/online/sharing/identity/deviceKeys';
import { LEFTOVER_NOTICE, MIGRATED_NOTICE } from '../../../src/connect/migrateFromFork';
import { FORK_DEVICE_KEYS_STORAGE, IMAGES_COPIED_KEY, type ImageCacheDeps } from '../../../src/connect/migrateLocalStores';
import { ConnectSettingsStore } from '../../../src/connect/settingsStore';
import { failureNotice, RETRY_COMMAND, startMigration, type MigrationStart } from '../../../src/connect/startMigration';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { fakeDataPlugin } from './fakeDataPlugin';
import { connected, HOSTING } from './hostingFixtures';

const FORK_SETTINGS = 'atlas-vtt/.atlas-data/settings.json';
const FORK_PEOPLE = 'atlas-vtt/.atlas-data/sharing/people.json';
const FORK_ITEMS = 'atlas-vtt/.atlas-data/sharing/items.json';
const OWN_SHARING = 'atlas-vtt/.atlas-data/extensions/atlas-vtt-connect/sharing';
const PEOPLE = JSON.stringify({ version: 1, people: [], retiredNames: [], placeholders: [] });
const ITEMS = JSON.stringify({ version: 1, notes: {} });
const WITH_SCENES: AtlasCapability[] = [...HOSTING, 'scenes'];
const WITH_SHARING: AtlasCapability[] = [...WITH_SCENES, 'bundles'];
const KEYS = { publicKey: 'public', privateKey: { kty: 'EC', crv: 'P-256', d: 'd', x: 'x', y: 'y' } };
const TABLE = { id: 'a'.repeat(43), publicKey: 'public-key', privateKey: { kty: 'EC', crv: 'P-256', d: 'secret', x: 'x', y: 'y' } };
const noImages: ImageCacheDeps = { exists: async () => false, open: async () => null };

/** Connect bound to an Atlas with these capabilities over a vault holding `files`; the storage folder waits for `answer()`. */
async function bound(capabilities: AtlasCapability[], files: Record<string, string>, start: MigrationStart = {}) {
  const store = await ConnectSettingsStore.load(fakeDataPlugin(null), memoryKeyValueStore());
  const notices: string[] = [];
  let answer = (): void => undefined;
  const gate = new Promise<void>((resolve) => { answer = resolve; });
  const fixture = connected(capabilities, gate, undefined, {
    files,
    options: { migration: store, migrationStart: { notify: (message) => { notices.push(message); }, images: noImages, rereadDelayMs: 0, ...start } },
  });
  // Obsidian's local storage, this vault on this device.
  const local = new Map<string, unknown>();
  Object.assign(fixture.connect.plugin.app, { loadLocalStorage: (key: string) => local.get(key) ?? null, saveLocalStorage: (key: string, value: unknown) => { local.set(key, value); } });
  return { ...fixture, store, notices, answer, local };
}

const own = (files: Map<string, string>): string[] => [...files.keys()].filter((path) => path.startsWith(`${OWN_SHARING}/`));

describe('the fork migration when Connect binds to Atlas', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

  it('brings the fork data over before hosting and sharing start, once, naming the folder left behind', async () => {
    const { connect, files, atlas, fire, store, notices, answer } = await bound(WITH_SHARING, { [FORK_PEOPLE]: PEOPLE });
    expect(connect.commands.has('start-online-session')).toBe(false);
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(files.get(`${OWN_SHARING}/people.json`)).toBe(PEOPLE);
    expect(connect.commands.has('start-online-session')).toBe(true);
    expect(connect.commands.has('shared-with-me')).toBe(true);
    expect(connect.commands.has(RETRY_COMMAND.id)).toBe(false);
    expect(store.migratedFromFork).toBe(true);
    expect(notices).toEqual([`${MIGRATED_NOTICE} ${LEFTOVER_NOTICE}`]);
    expect(LEFTOVER_NOTICE).toContain('atlas-vtt/.atlas-data/sharing');
    // An Atlas reload binds again: nothing runs twice.
    atlas.unload();
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '1.13.0', capabilities: WITH_SHARING }));
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toHaveLength(1);
    expect(connect.commands.has('start-online-session')).toBe(true);
  });

  it('a failed run keeps hosting and sharing off and offers the command, which finishes it in the same binding', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { connect, files, store, notices, answer } = await bound(WITH_SHARING, { [FORK_PEOPLE]: PEOPLE, [FORK_ITEMS]: ITEMS });
    vi.mocked(connect.plugin.app.vault.adapter.rename).mockRejectedValueOnce(new Error('Obsidian closed'));
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toEqual([failureNotice(new Error('Obsidian closed'))]);
    expect(notices[0]).toContain(`run "${RETRY_COMMAND.name}"`);
    expect(connect.commands.has('start-online-session')).toBe(false);
    expect(connect.commands.has('shared-with-me')).toBe(false);
    expect(own(files)).toEqual([]);
    expect(store.migratedFromFork).toBe(false);
    expect(connect.run(RETRY_COMMAND.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(files.get(`${OWN_SHARING}/items.json`)).toBe(ITEMS);
    expect(connect.commands.has('start-online-session')).toBe(true);
    expect(connect.commands.has('shared-with-me')).toBe(true);
    expect(connect.commands.has(RETRY_COMMAND.id)).toBe(false);
    expect(store.migratedFromFork).toBe(true);
    error.mockRestore();
  });

  it('a settings file that stays mid-rewrite keeps hosting off; the command then brings the table key', async () => {
    const { connect, files, store, notices, answer } = await bound(WITH_SCENES, { [FORK_SETTINGS]: '{"online": {"table": ' });
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toEqual([failureNotice('settings')]);
    expect(notices[0]).toContain('atlas-vtt/.atlas-data/settings.json');
    expect(connect.commands.has('start-online-session')).toBe(false);
    store.set({ playerName: 'Rin' }); // a join meanwhile: joining does not wait
    files.set(FORK_SETTINGS, JSON.stringify({ online: { playerName: 'GM', table: TABLE } }));
    connect.run(RETRY_COMMAND.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get().table).toEqual(TABLE);
    expect(store.get().playerName).toBe('Rin');
    expect(connect.commands.has('start-online-session')).toBe(true);
  });

  it('says what to do from the cause', () => {
    const code = (value: string): Error => Object.assign(new Error(value), { code: value });
    expect(failureNotice(code('ENOSPC'))).toContain('Free some disk space.');
    expect(failureNotice(code('EACCES'))).toContain("Check that the vault's files can be written");
    expect(failureNotice(new Error('odd'))).toContain('The developer console has the details.');
  });

  it('a setting typed during a stuck settings step survives a restart; the fork settings then come over under it', async () => {
    const data = fakeDataPlugin(null);
    const before = await ConnectSettingsStore.load(data, memoryKeyValueStore());
    before.set({ playerName: 'Rin' }); // the step was stuck on a half-written file when this was typed
    await before.flush();
    const store = await ConnectSettingsStore.load(fakeDataPlugin(data.saved.at(-1)), memoryKeyValueStore()); // Obsidian restarted
    const { plugin } = connected([], undefined, undefined, { files: { [FORK_SETTINGS]: JSON.stringify({ online: { playerName: 'GM', table: TABLE } }) } }).connect;
    const atlas = new FakeAtlas({ capabilities: [] });
    await startMigration(plugin.app, atlas, atlas.connect(plugin), store, { notify: () => undefined, images: noImages, rereadDelayMs: 0 });
    expect(store.get().playerName).toBe('Rin');
    expect(store.get().table).toEqual(TABLE);
  });

  it('a join that changes a setting while the folder is asked for keeps it, and the fork settings still come over', async () => {
    const forkSettings = { online: { playerName: 'GM', signaling: { mode: 'custom', host: 'peer.example', port: 9000, path: '/', key: 'k', secure: true } } };
    const { store, answer } = await bound(WITH_SCENES, { [FORK_SETTINGS]: JSON.stringify(forkSettings) });
    store.set({ playerName: 'Rin' }); // as OnlineJoinService does when a join starts
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get().signaling.host).toBe('peer.example');
    expect(store.get().playerName).toBe('Rin');
    expect(store.migratedFromFork).toBe(true);
  });

  it('copies the device keys before joining starts, once; without storage the settings still come over', async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin(null), memoryKeyValueStore());
    const local = new Map<string, unknown>([[FORK_DEVICE_KEYS_STORAGE, { 'table-a': KEYS }]]);
    const { connect } = connected([], undefined, undefined, { files: { [FORK_SETTINGS]: JSON.stringify({ online: { table: TABLE } }) } });
    Object.assign(connect.plugin.app, { loadLocalStorage: (key: string) => local.get(key) ?? null, saveLocalStorage: (key: string, value: unknown) => { local.set(key, value); } });
    const atlas = new FakeAtlas({ version: '1.13.0', capabilities: [] });
    const extension = atlas.connect(connect.plugin);
    const notices: string[] = [];
    const start: MigrationStart = { notify: (message) => { notices.push(message); }, images: noImages, rereadDelayMs: 0 };
    const first = startMigration(connect.plugin.app, atlas, extension, store, start);
    expect(local.get(DEVICE_KEYS_STORAGE)).toEqual({ 'table-a': KEYS });
    expect(startMigration(connect.plugin.app, atlas, extension, store, start)).toBe(first);
    expect(await first).toBe(true);
    expect(store.get().table).toEqual(TABLE);
    expect(notices).toEqual([MIGRATED_NOTICE]);
    // No storage, so the folder and the map shares wait for a newer Atlas.
    expect(store.migratedFromFork).toBe(false);
    // Device keys are merged on every start: a key found later still arrives.
    local.set(FORK_DEVICE_KEYS_STORAGE, { 'table-b': KEYS });
    await startMigration(connect.plugin.app, atlas, extension, store, start);
    expect(local.get(DEVICE_KEYS_STORAGE)).toEqual({ 'table-a': KEYS, 'table-b': KEYS });
    expect(await startMigration(connect.plugin.app, atlas, extension, undefined)).toBe(true);
  });

  it("copies the kept images only when the preview kept them, read after its settings arrive, and marks the step", async () => {
    const exists = vi.fn(async () => false);
    const off = await bound(WITH_SCENES, { [FORK_SETTINGS]: JSON.stringify({ online: { keepImages: false } }) }, { images: { exists, open: async () => null } });
    off.answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(exists).not.toHaveBeenCalled();
    expect(off.local.get(IMAGES_COPIED_KEY)).toBe(true);
    const on = await bound(WITH_SCENES, {}, { images: { exists, open: async () => null } });
    on.answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(exists).toHaveBeenCalledTimes(1);
    expect(on.local.get(IMAGES_COPIED_KEY)).toBe(true);
    expect(IMAGES_COPIED_KEY).toBe('atlas-vtt-connect:fork-images-copied');
    // The mark is this device's: it is not in the vault's settings file.
    expect(JSON.stringify(on.store.get())).not.toContain('images-copied');
  });

  it("a vault whose settings were synced from another device still merges this device's keys and copies its images", async () => {
    const synced = { online: {}, migratedFromFork: 1, forkSteps: ['settings', 'sharing', 'mapShares', 'keys', 'images'] };
    const store = await ConnectSettingsStore.load(fakeDataPlugin(synced), memoryKeyValueStore());
    const exists = vi.fn(async () => false);
    const { connect } = connected([], undefined, undefined, {});
    const local = new Map<string, unknown>([[FORK_DEVICE_KEYS_STORAGE, { 'table-a': KEYS }]]);
    Object.assign(connect.plugin.app, { loadLocalStorage: (key: string) => local.get(key) ?? null, saveLocalStorage: (key: string, value: unknown) => { local.set(key, value); } });
    const atlas = new FakeAtlas({ version: '1.13.0', capabilities: ['storage'] });
    expect(await startMigration(connect.plugin.app, atlas, atlas.connect(connect.plugin), store, { notify: () => undefined, images: { exists, open: async () => null } })).toBe(true);
    expect(local.get(DEVICE_KEYS_STORAGE)).toEqual({ 'table-a': KEYS });
    await vi.advanceTimersByTimeAsync(0);
    expect(exists).toHaveBeenCalledTimes(1);
    expect(local.get(IMAGES_COPIED_KEY)).toBe(true);
  });

  it('without storage, a settings step that cannot finish says nothing about hosting and offers no command', async () => {
    const { connect, notices, answer, store } = await bound([], { [FORK_SETTINGS]: '{"online": ' });
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(notices).toEqual([]);
    expect(connect.commands.has(RETRY_COMMAND.id)).toBe(false);
    expect(store.forkStepDone('settings')).toBe(false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(connect.plugin.app.vault.adapter.read).mockRejectedValueOnce(new Error('EBUSY'));
    expect(await startMigration(connect.plugin.app, new FakeAtlas({ capabilities: [] }), new FakeAtlas({ capabilities: [] }).connect(connect.plugin), store, { notify: (message) => { notices.push(message); }, images: noImages, rereadDelayMs: 0 })).toBe(true);
    expect(notices).toEqual([]);
    error.mockRestore();
  });
});
