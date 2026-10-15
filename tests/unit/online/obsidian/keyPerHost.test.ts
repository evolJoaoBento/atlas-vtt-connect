import { describe, expect, it } from 'vitest';
import { KEPT_PLAYER_KEYS, keyPerHost, PLAYER_KEYS_STORAGE } from '../../../../src/app/online/obsidian/keyPerHost';
import { memoryKeyValueStore } from '../../../../src/app/online/sharing/identity/deviceKeys';

describe('player keys per GM host', () => {
  it('gives each host its own key, the same every time', () => {
    const keys = keyPerHost();
    expect(keys('a')).toBe(keys('a'));
    expect(keys('a')).not.toBe(keys('b'));
  });

  it('keeps the keys across a reload when given a store', () => {
    const store = memoryKeyValueStore();
    const before = keyPerHost(store)('host');
    expect(keyPerHost(store)('host')).toBe(before);
  });

  it('keeps only the newest hosts and ignores a malformed store', () => {
    const store = memoryKeyValueStore();
    const keys = keyPerHost(store);
    const first = keys('h0');
    for (let index = 1; index <= KEPT_PLAYER_KEYS; index++) keys(`h${index}`);
    expect(store.get(PLAYER_KEYS_STORAGE)).toHaveLength(KEPT_PLAYER_KEYS);
    expect(keyPerHost(store)('h0')).not.toBe(first);
    const broken = memoryKeyValueStore();
    broken.set(PLAYER_KEYS_STORAGE, [['h', 5], 'x', ['g', 'kept']]);
    expect(keyPerHost(broken)('g')).toBe('kept');
  });
});
