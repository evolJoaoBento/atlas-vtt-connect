import { describe, expect, it } from 'vitest';
import { KEPT_PLAYER_KEYS, keptPlayerKey, pageKey } from '../../../src/app/online/page/pageStorage';

// Final review M9: the join page keeps one player key per GM session, and only for the newest sessions.

function memory(initial: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
    clear: () => data.clear(),
  };
}
const playerKeys = (storage: ReturnType<typeof memory>): string[] => [...storage.data.keys()].filter((key) => key.startsWith(pageKey('player-key:')));

describe('player keys on the join page', () => {
  it('keeps one key per session, the same on a second visit', () => {
    const storage = memory();
    let made = 0;
    const make = (): string => `k${++made}`;
    expect(keptPlayerKey(storage, 'gm-a', make)).toBe('k1');
    expect(keptPlayerKey(storage, 'gm-a', make)).toBe('k1');
    expect(keptPlayerKey(storage, 'gm-b', make)).toBe('k2');
    expect(storage.getItem(pageKey('player-key:gm-a'))).toBe('k1');
  });

  it('removes the oldest sessions past the limit, a session used again counting as new', () => {
    const storage = memory();
    for (let index = 0; index < KEPT_PLAYER_KEYS; index++) keptPlayerKey(storage, `gm-${index}`, () => `k${index}`);
    keptPlayerKey(storage, 'gm-0', () => 'never');
    keptPlayerKey(storage, 'gm-new', () => 'fresh');
    expect(playerKeys(storage)).toHaveLength(KEPT_PLAYER_KEYS);
    expect(storage.getItem(pageKey('player-key:gm-1'))).toBeNull();
    expect(storage.getItem(pageKey('player-key:gm-0'))).toBe('k0');
    expect(storage.getItem(pageKey('player-key:gm-new'))).toBe('fresh');
  });

  it('prunes keys kept before the order was recorded first, and leaves other keys alone', () => {
    const old = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [pageKey(`player-key:old-${index}`), `o${index}`]));
    const storage = memory({ ...old, [pageKey('name')]: 'Rin', 'atlas-online:player-key:fork': 'f' });
    keptPlayerKey(storage, 'gm-now', () => 'n', 3);
    expect(playerKeys(storage).sort()).toEqual([pageKey('player-key:gm-now'), pageKey('player-key:old-28'), pageKey('player-key:old-29')].sort());
    expect(storage.getItem(pageKey('name'))).toBe('Rin');
    expect(storage.getItem('atlas-online:player-key:fork')).toBe('f');
  });
});
