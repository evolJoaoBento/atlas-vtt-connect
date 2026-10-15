import { randomId } from '../ids';
import type { KeyValueStore } from '../sharing/identity/deviceKeys';

/** Where the player keys are kept in Obsidian's local storage: on this device and vault, never synced. */
export const PLAYER_KEYS_STORAGE = 'atlas-vtt-connect:player-keys';
/** How many GM sessions' player keys are kept; the oldest go first, like the join page's. */
export const KEPT_PLAYER_KEYS = 20;

/** The kept keys, oldest first, without anything of the wrong shape. */
function keptKeys(store: KeyValueStore): Array<[string, string]> {
  const value = store.get(PLAYER_KEYS_STORAGE);
  if (!Array.isArray(value)) return [];
  return value.filter((pair): pair is [string, string] =>
    Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string' && pair[1].length > 0 && pair[1].length <= 64);
}

/**
 * A function that gives each host id its own random key, the same one every time. With `store` the keys outlive a
 * reload of Obsidian or the plugin, so the GM sees a player who comes back as the same client, not a stranger.
 */
export function keyPerHost(store?: KeyValueStore): (hostId: string) => string {
  const keys = new Map<string, string>(store ? keptKeys(store) : []);
  return (hostId) => {
    const key = keys.get(hostId) ?? randomId();
    // Newest last: a re-insert moves it to the end.
    keys.delete(hostId);
    keys.set(hostId, key);
    while (keys.size > KEPT_PLAYER_KEYS) keys.delete(keys.keys().next().value!);
    store?.set(PLAYER_KEYS_STORAGE, [...keys]);
    return key;
  };
}
