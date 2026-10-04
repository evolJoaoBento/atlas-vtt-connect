/**
 * The join page's image texts. Shared with the web player page, so it imports
 * only types. One MB is 1024 × 1024 bytes, shown with one decimal.
 */
import type { AssetCacheState } from '../assets/AssetCache';
import type { AssetProgress } from '../assets/AssetLoader';

const MB = 1024 * 1024;

function megabytes(bytes: number): string {
  return (bytes / MB).toFixed(1);
}

/** The loading bar's text; null when nothing is outstanding, and the bar hides. */
export function progressText(progress: AssetProgress): string | null {
  if (progress.outstanding === 0) return null;
  if (progress.totalBytes === 0) return 'Loading images…';
  return `Loading images… ${megabytes(progress.receivedBytes)} of ${megabytes(progress.totalBytes)} MB`;
}

/** The switch's label: what it does, or why it cannot. */
export function keepImagesText(state: AssetCacheState): string {
  return state.available ? 'Keep images on this device' : "Can't save on this device";
}

/** The clear button, with the space the kept images use. */
export function clearImagesText(usedBytes: number): string {
  return usedBytes > 0 ? `Clear saved images (${megabytes(usedBytes)} MB)` : 'Clear saved images';
}
