/**
 * What the join page keeps in the browser, under `atlas-vtt-connect:` keys. The page's address
 * (github.io) is shared with the fork's old page, so a setting kept there is read once from its
 * old key and copied to the new one. Shared with the web page.
 */
const PREFIX = 'atlas-vtt-connect:';
// Migrates the fork's setting: the only place the old prefix may appear (B17's grep exempts this line).
const FORK_PREFIX = 'atlas-online:';

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
