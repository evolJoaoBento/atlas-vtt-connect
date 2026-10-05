/**
 * What the join page keeps in the browser, under `atlas-vtt-connect:` keys. The page's address
 * (github.io) is shared with the fork's old page, so a setting kept there is read once from its
 * old key and copied to the new one. Shared with the web page.
 */
const PREFIX = 'atlas-vtt-connect:';
// Migrates the fork's settings and stores: the only place the fork's name may appear (B17's grep exempts this line).
export const FORK_NAME = 'atlas-online';
const FORK_PREFIX = `${FORK_NAME}:`;

export const pageKey = (name: string): string => PREFIX + name;

/** The kept value of `name`, else the fork's (copied to the new key); null when there is none. Can throw: storage may. */
export function readKept(storage: Pick<Storage, 'getItem' | 'setItem'>, name: string): string | null {
  const own = storage.getItem(pageKey(name));
  if (own !== null) return own;
  const fork = storage.getItem(FORK_PREFIX + name);
  if (fork !== null) {
    try {
      storage.setItem(pageKey(name), fork);
    } catch {
      // The old value still applies to this visit.
    }
  }
  return fork;
}

/** How many GM sessions' player keys the page keeps; older ones are removed (final review M9). */
export const KEPT_PLAYER_KEYS = 20;
const PLAYER_KEY = 'player-key:';
const PLAYER_KEY_ORDER = pageKey('player-key-order');

type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Host ids with a kept player key, oldest first: the recorded order, then any key kept before it was recorded. */
function playerKeyHosts(storage: KeyStorage): string[] {
  let order: unknown;
  try {
    order = JSON.parse(storage.getItem(PLAYER_KEY_ORDER) ?? '[]');
  } catch {
    order = [];
  }
  const recorded = Array.isArray(order) ? order.filter((host): host is string => typeof host === 'string') : [];
  const unrecorded: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    const host = key?.startsWith(pageKey(PLAYER_KEY)) ? key.slice(pageKey(PLAYER_KEY).length) : null;
    if (host !== null && !recorded.includes(host)) unrecorded.push(host);
  }
  return [...unrecorded, ...recorded];
}

/**
 * The player key for one GM session (`hostId`), made with `make` the first time, as `readKept` reads it. Only the
 * newest `limit` sessions keep theirs, so keys do not pile up on the shared github.io origin. Can throw: storage may.
 */
export function keptPlayerKey(storage: KeyStorage, hostId: string, make: () => string, limit = KEPT_PLAYER_KEYS): string {
  const value = readKept(storage, `${PLAYER_KEY}${hostId}`) ?? make();
  storage.setItem(pageKey(`${PLAYER_KEY}${hostId}`), value);
  const hosts = [...playerKeyHosts(storage).filter((host) => host !== hostId), hostId];
  const dropped = hosts.splice(0, Math.max(0, hosts.length - limit));
  for (const host of dropped) storage.removeItem(pageKey(`${PLAYER_KEY}${host}`));
  storage.setItem(PLAYER_KEY_ORDER, JSON.stringify(hosts));
  return value;
}
