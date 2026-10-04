import { describe, expect, it } from 'vitest';
import { AssetCache, type AssetCacheState, type StoredImage } from '../../../src/app/online/assets/AssetCache';
import { MemoryStore } from './assetFixtures';
import { fingerprint as fp } from './sceneFixtures';

const image = (n: number, size: number): StoredImage => ({ id: fp(n), mime: 'image/png', bytes: new ArrayBuffer(size) });

const settleLater = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 1); });

function clock(): () => number {
  let now = 0;
  return () => ++now;
}

describe('AssetCache', () => {
  it('keeps images on the device across visits', async () => {
    const store = new MemoryStore();
    const first = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    await first.put(image(1, 100));
    expect(first.state).toEqual({ keep: true, available: true, usedBytes: 100 });

    const second = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    expect(await second.get(fp(1))).toMatchObject({ id: fp(1), mime: 'image/png' });
    expect(second.state.usedBytes).toBe(100);
    expect(await second.get(fp(2))).toBeNull();
  });

  it('keeps images in memory only with keeping off, and switching it off deletes what was stored', async () => {
    const store = new MemoryStore();
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    await cache.put(image(1, 100));
    await cache.setKeep(false);
    expect(store.images.size).toBe(0);
    expect(cache.state).toEqual({ keep: false, available: true, usedBytes: 0 });

    await cache.put(image(2, 50));
    expect(store.images.size).toBe(0);
    expect(await cache.get(fp(2))).not.toBeNull();
    const nextVisit = new AssetCache({ keep: false, openStore: async () => store });
    expect(await nextVisit.get(fp(2))).toBeNull();
  });

  it('drops the least recently shown images beyond its limit', async () => {
    const store = new MemoryStore();
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock(), limitBytes: 100 });
    await cache.put(image(1, 40));
    await cache.put(image(2, 40));
    await cache.get(fp(1)); // shown again: now the most recent
    await cache.put(image(3, 40));
    expect([...store.images.keys()].sort()).toEqual([fp(1), fp(3)].sort());
    expect(cache.state.usedBytes).toBe(80);

    const inMemory = new AssetCache({ keep: false, openStore: async () => store, now: clock(), limitBytes: 100 });
    await inMemory.put(image(4, 60));
    await inMemory.put(image(5, 60));
    expect(await inMemory.get(fp(4))).toBeNull();
    expect(await inMemory.get(fp(5))).not.toBeNull();
  });

  it('makes room when storage is full, and keeps an image that still does not fit in memory', async () => {
    const store = new MemoryStore();
    store.quota = 100;
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    await cache.put(image(1, 60));
    await cache.put(image(2, 60)); // over the quota: image 1 goes, then it fits
    expect([...store.images.keys()]).toEqual([fp(2)]);

    store.quota = 10;
    await cache.put(image(3, 60)); // never fits: kept for this visit only
    expect(store.images.has(fp(3))).toBe(false);
    expect(await cache.get(fp(3))).not.toBeNull();
    expect(cache.state.available).toBe(false);
  });

  it('works in memory when storage is unavailable', async () => {
    for (const openStore of [async (): Promise<null> => null, async (): Promise<never> => { throw new Error('blocked'); }]) {
      const cache = new AssetCache({ keep: true, openStore });
      await cache.put(image(1, 10));
      expect(await cache.get(fp(1))).not.toBeNull();
      expect(cache.state).toEqual({ keep: true, available: false, usedBytes: 0 });
    }
  });

  it('clears saved images and tells listeners the space used', async () => {
    const store = new MemoryStore();
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    const states: AssetCacheState[] = [];
    cache.onChange((state) => states.push(state));
    await cache.put(image(1, 100));
    await cache.clearSaved();
    expect(store.images.size).toBe(0);
    expect(states.map((state) => state.usedBytes)).toEqual([100, 0]);
  });

  it('ignores stored records that are not images', async () => {
    const store = new MemoryStore();
    store.images.set(fp(1), { image: { id: fp(1), mime: 'text/html', bytes: new ArrayBuffer(1) } as unknown as StoredImage, shownAt: 1 });
    store.images.set(fp(2), { image: { id: fp(2), mime: 'image/png', bytes: 'not bytes' } as unknown as StoredImage, shownAt: 1 });
    const cache = new AssetCache({ keep: true, openStore: async () => store });
    expect(await cache.get(fp(1))).toBeNull();
    expect(await cache.get(fp(2))).toBeNull();
  });

  it('falls back to memory when any storage call fails', async () => {
    const store = new MemoryStore();
    const fail = async (): Promise<never> => { throw new Error('aborted'); };
    store.get = fail;
    store.put = fail;
    store.delete = fail;
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    await cache.put(image(1, 10));
    expect(await cache.get(fp(1))).not.toBeNull();
    expect(cache.state.available).toBe(false);
    store.clear = fail;
    await expect(cache.clearSaved()).resolves.toBeUndefined();
    await expect(cache.setKeep(false)).resolves.toBeUndefined();
  });

  it('keeps to its limit when puts overlap', async () => {
    const store = new MemoryStore();
    const put = store.put.bind(store);
    store.put = async (stored, shownAt): Promise<void> => { await settleLater(); await put(stored, shownAt); };
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock(), limitBytes: 100 });
    await Promise.all([cache.put(image(1, 60)), cache.put(image(2, 60)), cache.put(image(3, 60))]);
    expect(cache.state.usedBytes).toBeLessThanOrEqual(100);
    expect([...store.images.values()].reduce((sum, { image: held }) => sum + held.bytes.byteLength, 0)).toBeLessThanOrEqual(100);
    expect(store.images.has(fp(3))).toBe(true);
  });

  it('leaves nothing stored when keeping is switched off during a write', async () => {
    const store = new MemoryStore();
    const put = store.put.bind(store);
    store.put = async (stored, shownAt): Promise<void> => { await settleLater(); await put(stored, shownAt); };
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    const writing = cache.put(image(1, 10));
    const off = cache.setKeep(false);
    await Promise.all([writing, off]);
    expect(store.images.size).toBe(0);
    expect(cache.state).toEqual({ keep: false, available: true, usedBytes: 0 });
  });

  it('forgets a row whose image the storage lost', async () => {
    const store = new MemoryStore();
    const first = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    await first.put(image(1, 100));
    store.get = async (): Promise<null> => null;
    const second = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    expect(second.state.usedBytes).toBe(0);
    expect(await second.get(fp(1))).toBeNull();
    await second.clearSaved();
    expect(second.state.usedBytes).toBe(0);
    const third = new AssetCache({ keep: true, openStore: async () => store, now: clock() });
    await third.put(image(2, 5));
    await third.get(fp(2));
    expect(third.state.usedBytes).toBe(5);
  });

  it('counts a repeated put as shown and holds one copy', async () => {
    const store = new MemoryStore();
    const cache = new AssetCache({ keep: true, openStore: async () => store, now: clock(), limitBytes: 100 });
    await cache.put(image(1, 40));
    await cache.put(image(2, 40));
    await cache.put(image(1, 40)); // shown again: image 2 is now the oldest
    await cache.put(image(3, 40));
    expect([...store.images.keys()].sort()).toEqual([fp(1), fp(3)].sort());

    const inMemory = new AssetCache({ keep: false, openStore: async () => store, now: clock(), limitBytes: 100 });
    await inMemory.put(image(4, 40));
    await inMemory.put(image(4, 40));
    await inMemory.put(image(5, 40));
    await inMemory.put(image(6, 40)); // 4 twice would have used 80 already
    expect(await inMemory.get(fp(4))).toBeNull();
    expect(await inMemory.get(fp(5))).not.toBeNull();
  });

  it('lets go of its memory and closes the storage when disposed, and keeps nothing afterwards', async () => {
    const store = new MemoryStore();
    const cache = new AssetCache({ keep: false, openStore: async () => store, now: clock() });
    await cache.put(image(1, 100));
    expect(await cache.get(fp(1))).not.toBeNull();
    await cache.dispose();
    expect(store.closed).toBe(true);
    await cache.put(image(2, 100));
    expect(await cache.get(fp(1))).toBeNull();
    expect(await cache.get(fp(2))).toBeNull();
  });
});
