import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectSettingsStore, FORK_PLAYER_PAGE_URL, type ForkStep } from '../../../src/connect/settingsStore';
import { fakeDataPlugin } from './fakeDataPlugin';
import { memoryKeyValueStore } from '../../../src/app/online/sharing/identity/deviceKeys';

afterEach(() => { vi.useRealTimers(); });

describe('ConnectSettingsStore', () => {
  it('loads defaults with the new player page, keeps a stored custom page, and saves debounced', async () => {
    vi.useFakeTimers();
    const plugin = fakeDataPlugin({ online: { playerPageUrl: 'https://my.example/page/' } });
    const store = await ConnectSettingsStore.load(plugin, memoryKeyValueStore());
    expect(store.get().playerPageUrl).toBe('https://my.example/page/');
    const fresh = await ConnectSettingsStore.load(fakeDataPlugin(null), memoryKeyValueStore());
    expect(fresh.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
    store.set({ playerName: 'GM' });
    expect(plugin.saved).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(plugin.saved.at(-1)).toMatchObject({ online: { playerName: 'GM' } });
  });

  it("moves the fork's old default player page to Connect's", async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin({ online: { playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt/' } }), memoryKeyValueStore());
    expect(store.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
  });

  it('knows which settings changed while the settings step is not done, and moves the old default page with or without its slash', async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin({ online: { playerName: 'Stored' } }), memoryKeyValueStore());
    expect([...store.changedSinceLoad]).toEqual([]);
    store.set({ playerName: 'GM', keepImages: false });
    expect([...store.changedSinceLoad]).toEqual(['playerName', 'keepImages']);
    const slashless = await ConnectSettingsStore.load(fakeDataPlugin({ online: { playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt' } }), memoryKeyValueStore());
    expect(slashless.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
    const lookalike = await ConnectSettingsStore.load(fakeDataPlugin({ online: { playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt-x/' } }), memoryKeyValueStore());
    expect(lookalike.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-x/');
    expect(FORK_PLAYER_PAGE_URL).toBe('https://evoljoaobento.github.io/atlas-vtt/');
  });

  it("keeps each vault step's mark, saved at once; the three together mark the migration", async () => {
    vi.useFakeTimers();
    // `keys` and `images` were device marks in data.json once: ignored now, as are unknown ones.
    const plugin = fakeDataPlugin({ online: {}, forkSteps: ['settings', 'nonsense', 'keys', 'images'] });
    const store = await ConnectSettingsStore.load(plugin, memoryKeyValueStore());
    expect(['settings', 'sharing', 'mapShares'].map((step) => store.forkStepDone(step as ForkStep))).toEqual([true, false, false]);
    store.markForkStep('sharing');
    expect(plugin.saved.at(-1)).toMatchObject({ forkSteps: ['settings', 'sharing'] }); // no 500 ms wait
    expect(store.migratedFromFork).toBe(false);
    store.markForkStep('mapShares');
    await store.flush();
    expect(store.migratedFromFork).toBe(true);
    expect(plugin.saved.at(-1)).toMatchObject({ migratedFromFork: 1, forkSteps: ['settings', 'sharing', 'mapShares'] });
    // Marked migrated before steps had marks: every step counts as done.
    const older = await ConnectSettingsStore.load(fakeDataPlugin({ online: {}, migratedFromFork: 1 }), memoryKeyValueStore());
    expect([older.forkStepDone('settings'), older.forkStepDone('sharing'), older.forkStepDone('mapShares')]).toEqual([true, true, true]);
  });

  it('keeps the settings changed while the settings step is not done across restarts, and forgets them once it is', async () => {
    const plugin = fakeDataPlugin(null);
    const store = await ConnectSettingsStore.load(plugin, memoryKeyValueStore());
    store.set({ playerName: 'Rin' });
    await store.flush();
    expect(plugin.saved.at(-1)).toMatchObject({ forkOwnKeys: ['playerName'] });
    const restarted = await ConnectSettingsStore.load(fakeDataPlugin({ ...(plugin.saved.at(-1) as object), forkOwnKeys: ['playerName', 'nope', 7] }), memoryKeyValueStore());
    expect([...restarted.changedSinceLoad]).toEqual(['playerName']);
    restarted.markForkStep('settings');
    expect([...restarted.changedSinceLoad]).toEqual([]);
    restarted.set({ logEvents: true });
    expect([...restarted.changedSinceLoad]).toEqual([]);
    await restarted.flush();
    const done = await ConnectSettingsStore.load(fakeDataPlugin({ online: {}, forkSteps: ['settings'], forkOwnKeys: ['playerName'] }), memoryKeyValueStore());
    expect([...done.changedSinceLoad]).toEqual([]);
  });

  it('keeps one save for a burst of changes and tells listeners until they unsubscribe', async () => {
    vi.useFakeTimers();
    const plugin = fakeDataPlugin(undefined);
    const store = await ConnectSettingsStore.load(plugin, memoryKeyValueStore());
    const listener = vi.fn();
    const stop = store.onChange(listener);
    store.set({ playerName: 'A' });
    vi.advanceTimersByTime(300);
    store.set({ playerName: 'B' });
    vi.advanceTimersByTime(300);
    expect(plugin.saved).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(plugin.saved).toHaveLength(1);
    expect(plugin.saved[0]).toMatchObject({ online: { playerName: 'B' } });
    stop();
    store.set({ playerName: 'C' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('remembers the migration from the fork, and saves it', async () => {
    vi.useFakeTimers();
    const plugin = fakeDataPlugin({ online: {}, migratedFromFork: 1 });
    expect((await ConnectSettingsStore.load(plugin, memoryKeyValueStore())).migratedFromFork).toBe(true);
    const fresh = await ConnectSettingsStore.load(fakeDataPlugin(null), memoryKeyValueStore());
    expect(fresh.migratedFromFork).toBe(false);
    const writer = fakeDataPlugin(null);
    const store = await ConnectSettingsStore.load(writer, memoryKeyValueStore());
    store.markMigrated();
    vi.advanceTimersByTime(500);
    expect(writer.saved.at(-1)).toMatchObject({ migratedFromFork: 1 });
    expect(store.migratedFromFork).toBe(true);
  });

  it('flushes a waiting change at once and survives stored data of any shape', async () => {
    vi.useFakeTimers();
    const plugin = fakeDataPlugin('not an object');
    const store = await ConnectSettingsStore.load(plugin, memoryKeyValueStore());
    expect(store.get().signaling.mode).toBe('cloud');
    store.set({ logEvents: true });
    await store.flush();
    expect(plugin.saved.at(-1)).toMatchObject({ online: { logEvents: true } });
    await store.flush();
    expect(plugin.saved).toHaveLength(1);
  });
});
