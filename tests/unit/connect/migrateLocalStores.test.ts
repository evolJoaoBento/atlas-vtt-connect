import { describe, expect, it, vi } from 'vitest';
import { FORK_DEVICE_KEYS_STORAGE, FORK_IMAGES_DB_NAME, migrateDeviceKeys, migrateImageCache, type ImageCacheDeps } from '../../../src/connect/migrateLocalStores';
import { IMAGES_DB_NAME } from '../../../src/app/online/assets/indexedDbImageStore';
import { DEVICE_KEYS_STORAGE, memoryKeyValueStore } from '../../../src/app/online/sharing/identity/deviceKeys';
import { MemoryStore } from '../online/assetFixtures';

const keys = (name: string): unknown => ({ publicKey: `public-${name}`, privateKey: { kty: 'EC', crv: 'P-256', d: `d-${name}`, x: 'x', y: 'y' } });
const id = (char: string): string => char.repeat(43);
const image = (char: string): { id: string; mime: 'image/png'; bytes: ArrayBuffer } => ({ id: id(char), mime: 'image/png', bytes: new TextEncoder().encode(char).buffer as ArrayBuffer });

describe('migrateDeviceKeys', () => {
  it("adds the fork's key of each table this device has none for; Connect's own keys win; the fork's stay", () => {
    const store = memoryKeyValueStore();
    const fork = { 'table-a': keys('fork-a'), 'table-b': keys('fork-b'), 'table-c': 'not a key', 'table-d': { publicKey: 'p', privateKey: { kty: 'RSA' } } };
    store.set(FORK_DEVICE_KEYS_STORAGE, fork);
    store.set(DEVICE_KEYS_STORAGE, { 'table-b': keys('own-b') });
    expect(FORK_DEVICE_KEYS_STORAGE).toBe(['atlas', 'online', 'device', 'keys'].join('-'));
    expect(migrateDeviceKeys(store)).toBe(1);
    expect(store.get(DEVICE_KEYS_STORAGE)).toEqual({ 'table-a': keys('fork-a'), 'table-b': keys('own-b') });
    expect(store.get(FORK_DEVICE_KEYS_STORAGE)).toEqual(fork);
    // Twice is the same as once.
    expect(migrateDeviceKeys(store)).toBe(0);
    expect(store.get(DEVICE_KEYS_STORAGE)).toEqual({ 'table-a': keys('fork-a'), 'table-b': keys('own-b') });
  });

  it('does nothing without fork keys, or with fork keys of any other shape', () => {
    for (const stored of [null, 'text', [keys('a')], 42]) {
      const store = memoryKeyValueStore();
      store.set(FORK_DEVICE_KEYS_STORAGE, stored);
      const set = vi.spyOn(store, 'set');
      expect(migrateDeviceKeys(store)).toBe(0);
      expect(set).not.toHaveBeenCalled();
    }
  });
});

describe('migrateImageCache', () => {
  function caches(fork: MemoryStore | null, own: MemoryStore, forkExists = true): ImageCacheDeps & { opened: string[] } {
    const opened: string[] = [];
    return {
      opened,
      exists: async (name) => name === FORK_IMAGES_DB_NAME && forkExists,
      open: async (name) => { opened.push(name); return name === FORK_IMAGES_DB_NAME ? fork : own; },
    };
  }

  it("copies the fork's valid images Connect lacks, keeping when each was shown, and closes both", async () => {
    const fork = new MemoryStore();
    const own = new MemoryStore();
    await fork.put(image('a'), 10);
    await fork.put(image('b'), 20);
    await fork.put({ ...image('c'), mime: 'text/html' as 'image/png' }, 30);
    await own.put(image('b'), 99);
    expect(await migrateImageCache(caches(fork, own))).toBe(1);
    expect(own.images.get(id('a'))?.shownAt).toBe(10);
    expect(own.images.get(id('b'))?.shownAt).toBe(99);
    expect(own.images.has(id('c'))).toBe(false);
    expect(fork.images.size).toBe(3);
    expect(fork.closed && own.closed).toBe(true);
    expect(await migrateImageCache(caches(fork, own))).toBe(0);
  });

  it("stops at the cache's limit, the most recently shown first", async () => {
    const fork = new MemoryStore();
    const own = new MemoryStore();
    await own.put(image('o'), 1); // 1 byte already kept
    await fork.put(image('a'), 10);
    await fork.put(image('b'), 30);
    await fork.put(image('c'), 20);
    expect(await migrateImageCache(caches(fork, own), 3)).toBe(2);
    expect([...own.images.keys()].sort()).toEqual([id('b'), id('c'), id('o')]);
  });

  it('never opens (so never creates) a fork database that is not there', async () => {
    const run = caches(new MemoryStore(), new MemoryStore(), false);
    expect(await migrateImageCache(run)).toBe(0);
    expect(run.opened).toEqual([]);
  });

  it('stops quietly when a store fails, keeping what was copied', async () => {
    const fork = new MemoryStore();
    const own = new MemoryStore();
    await fork.put(image('a'), 1);
    await fork.put(image('b'), 2);
    own.quota = 1;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Past the given limit nothing more is copied; a store that refuses (here, its quota) fails the copy: tried again later.
    expect(await migrateImageCache(caches(fork, own))).toBeNull();
    expect(own.images.size).toBe(1);
    expect(error).toHaveBeenCalled();
    expect(await migrateImageCache(caches(null, own))).toBe(0);
    expect(IMAGES_DB_NAME).toBe('atlas-vtt-connect-images');
    error.mockRestore();
  });
});
