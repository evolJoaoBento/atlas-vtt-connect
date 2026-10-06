/**
 * A fog record that keeps its identity while its operations stay the same. A snapshot (a resync, a reconnect) arrives
 * as new objects for operations that did not change, and everything keyed on identity (the page's fog image, Atlas's
 * remote view, the converted operations of `RemoteSceneMemo`) would work the whole fog out again for nothing.
 * Imports only the wire types.
 */
import { sameValue } from './sceneDiff';
import type { PlayerFogOp } from './sceneTypes';

/**
 * `next`, with each operation that equals the one `previous` had under its id replaced by that object; the whole of
 * `previous` when nothing differs at all. Nothing is shared when an operation changed.
 */
export function keepFogIdentity(
  previous: Readonly<Record<string, PlayerFogOp>> | undefined,
  next: Record<string, PlayerFogOp>,
): Record<string, PlayerFogOp> {
  if (!previous) return next;
  let allSame = Object.keys(previous).length === Object.keys(next).length;
  for (const id of Object.keys(next)) {
    const before = Object.hasOwn(previous, id) ? previous[id] : undefined;
    const after = next[id];
    if (before !== undefined && after !== undefined && sameValue(before, after)) {
      Object.defineProperty(next, id, { value: before, enumerable: true, writable: true, configurable: true });
    } else {
      allSame = false;
    }
  }
  return allSame ? previous : next;
}
