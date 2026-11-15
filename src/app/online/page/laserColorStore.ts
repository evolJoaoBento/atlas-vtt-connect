/**
 * The laser color a player picked on the join page, kept in the browser so it is theirs on the
 * next visit. Storage can throw (private windows) or hold anything: only a swatch is taken.
 * Shared with the web page.
 */
import { swatchLaserColor } from '../tools/laserColors';
import { pageKey, readKept } from './pageStorage';

export const LASER_COLOR_KEY = pageKey('laser-color');

/** The page passes `() => localStorage`: reaching for it can throw, so it is read inside the guard. */
type Reader = () => Pick<Storage, 'getItem' | 'setItem'>;
type Writer = () => Pick<Storage, 'setItem'>;

/** The remembered swatch, or null when there is none or storage is unavailable. */
export function loadLaserColor(storage: Reader): string | null {
  try {
    return swatchLaserColor(readKept(storage(), 'laser-color'));
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

export const LASER_SIZE_KEY = pageKey('laser-size');

/** The remembered laser size (Atlas's 8 to 100), or null when there is none or storage is unavailable. */
export function loadLaserSize(storage: Reader): number | null {
  try {
    const size = Number(readKept(storage(), 'laser-size'));
    return Number.isFinite(size) && size >= 8 && size <= 100 ? Math.round(size) : null;
  } catch {
    return null;
  }
}

export function saveLaserSize(size: number, storage: Writer): void {
  if (!Number.isFinite(size)) return;
  try {
    storage().setItem(LASER_SIZE_KEY, String(Math.round(size)));
  } catch {
    // The pick still applies to this visit.
  }
}
