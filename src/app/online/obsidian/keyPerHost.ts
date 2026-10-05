import { randomId } from '../ids';

/** A function that gives each host id its own random key, the same one every time. */
export function keyPerHost(): (hostId: string) => string {
  const keys = new Map<string, string>();
  return (hostId) => {
    const known = keys.get(hostId);
    if (known) return known;
    const key = randomId();
    keys.set(hostId, key);
    return key;
  };
}
