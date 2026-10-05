import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectSettingsStore, FORK_PLAYER_PAGE_URL, type ForkStep } from '../../../src/connect/settingsStore';
import { fakeDataPlugin } from './fakeDataPlugin';

afterEach(() => { vi.useRealTimers(); });

describe('ConnectSettingsStore', () => {
  it('loads defaults with the new player page, keeps a stored custom page, and saves debounced', async () => {
    vi.useFakeTimers();
    const plugin = fakeDataPlugin({ online: { playerPageUrl: 'https://my.example/page/' } });
    const store = await ConnectSettingsStore.load(plugin);
    expect(store.get().playerPageUrl).toBe('https://my.example/page/');
    const fresh = await ConnectSettingsStore.load(fakeDataPlugin(null));
    expect(fresh.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
    store.set({ playerName: 'GM' });
    expect(plugin.saved).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(plugin.saved.at(-1)).toMatchObject({ online: { playerName: 'GM' } });
  });

  it("moves the fork's old default player page to Connect's", async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin({ online: { playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt/' } }));
    expect(store.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
  });

  it('knows which settings changed since loading, and moves the old default page with or without its slash', async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin({ online: { playerName: 'Stored' } }));
    expect([...store.changedSinceLoad]).toEqual([]);
    store.set({ playerName: 'GM', keepImages: false });
    expect([...store.changedSinceLoad]).toEqual(['playerName', 'keepImages']);
    const slashless = await ConnectSettingsStore.load(fakeDataPlugin({ online: { playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt' } }));
    expect(slashless.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-connect/');
    const lookalike = await ConnectSettingsStore.load(fakeDataPlugin({ online: { playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt-x/' } }));
    expect(lookalike.get().playerPageUrl).toBe('https://evoljoaobento.github.io/atlas-vtt-x/');
    expect(FORK_PLAYER_PAGE_URL).toBe('https://evoljoaobento.github.io/atlas-vtt/');
  });

  it("keeps each migration step's mark; the vault's three together mark the migration, the device's stay apart", async () => {
    vi.useFakeTimers();
    const plugin = fakeDataPlugin({ online: {}, forkSteps: ['settings', 'nonsense', 'keys'] });
    const store = await ConnectSettingsStore.load(plugin);
    expect(['settings', 'sharing', 'mapShares', 'keys', 'images'].map((step) => store.forkStepDone(step as ForkStep))).toEqual([true, false, false, true, false]);
    store.markForkStep('sharing');
    expect(store.migratedFromFork).toBe(false);
    store.markForkStep('mapShares');
    expect(store.migratedFromFork).toBe(true);
    expect(store.forkStepDone('images')).toBe(false);
    vi.advanceTimersByTime(500);
    expect(plugin.saved.at(-1)).toMatchObject({ migratedFromFork: 1, forkSteps: ['settings', 'keys', 'sharing', 'mapShares'] });
    // Marked migrated before steps had marks: the vault's steps count as done, the device's do not.
    const older = await ConnectSettingsStore.load(fakeDataPlugin({ online: {}, migratedFromFork: 1 }));
    expect([older.forkStepDone('settings'), older.forkStepDone('sharing'), older.forkStepDone('keys')]).toEqual([true, true, false]);
  });

  it('keeps one save for a burst of changes and tells listeners until they unsubscribe', async () => {
    vi.useFakeTimers();
    const plugin = fakeDataPlugin(undefined);
    const store = await ConnectSettingsStore.load(plugin);
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
    expect((await ConnectSettingsStore.load(plugin)).migratedFromFork).toBe(true);
    const fresh = await ConnectSettingsStore.load(fakeDataPlugin(null));
    expect(fresh.migratedFromFork).toBe(false);
    const writer = fakeDataPlugin(null);
    const store = await ConnectSettingsStore.load(writer);
    store.markMigrated();
    vi.advanceTimersByTime(500);
    expect(writer.saved.at(-1)).toMatchObject({ migratedFromFork: 1 });
    expect(store.migratedFromFork).toBe(true);
  });

  it('flushes a waiting change at once and survives stored data of any shape', async () => {
    vi.useFakeTimers();
    const plugin = fakeDataPlugin('not an object');
    const store = await ConnectSettingsStore.load(plugin);
    expect(store.get().signaling.mode).toBe('cloud');
    store.set({ logEvents: true });
    await store.flush();
    expect(plugin.saved.at(-1)).toMatchObject({ online: { logEvents: true } });
    await store.flush();
    expect(plugin.saved).toHaveLength(1);
  });
});
