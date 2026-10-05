/**
 * The laser color a player picked on the join page, kept in the browser so it is theirs on the
 * next visit. Storage can throw (private windows) or hold anything: only a swatch is taken.
 * Shared with the web page.
 */
import { swatchLaserColor } from '../tools/laserColors';

export const LASER_COLOR_KEY = 'atlas-online:laser-color';

/** The page passes `() => localStorage`: reaching for it can throw, so it is read inside the guard. */
type Reader = () => Pick<Storage, 'getItem'>;
type Writer = () => Pick<Storage, 'setItem'>;

/** The remembered swatch, or null when there is none or storage is unavailable. */
export function loadLaserColor(storage: Reader): string | null {
  try {
    return swatchLaserColor(storage().getItem(LASER_COLOR_KEY));
  } catch {
    return null;
  }
}

export function saveLaserColor(color: string, storage: Writer): void {
  const swatch = swatchLaserColor(color);
  if (!swatch) return;
  try {
    storage().setItem(LASER_COLOR_KEY, swatch);
  } catch {
    // The pick still applies to this visit.
  }
}
