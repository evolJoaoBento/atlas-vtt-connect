// online-client/assetsPanel.mts
/**
 * The join page's image controls: the loading bar above the preview, and the
 * "Keep images on this device" switch and "Clear saved images" button under
 * it. Text goes through `textContent` only.
 */
import type { AssetCache, AssetCacheState } from '../src/app/online/assets/AssetCache';
import type { AssetProgress } from '../src/app/online/assets/AssetLoader';
import { clearImagesText, keepImagesText, progressText } from '../src/app/online/preview/assetStatus';

const KEEP_KEY = 'atlas-online:keep-images';

/** The remembered switch: on unless the player turned it off. localStorage can throw in private windows. */
export function rememberedKeep(): boolean {
  try {
    return localStorage.getItem(KEEP_KEY) !== 'off';
  } catch {
    return true;
  }
}

function rememberKeep(keep: boolean): void {
  try {
    localStorage.setItem(KEEP_KEY, keep ? 'on' : 'off');
  } catch {
    // Private window: the switch still works for this visit.
  }
}

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export class AssetsPanel {
  private readonly progress = element<HTMLElement>('image-progress');
  private readonly bar = element<HTMLProgressElement>('image-progress-bar');
  private readonly progressLabel = element<HTMLElement>('image-progress-text');
  private readonly keep = element<HTMLInputElement>('keep-images');
  private readonly keepLabel = element<HTMLElement>('keep-images-label');
  private readonly clear = element<HTMLButtonElement>('clear-images');

  constructor(cache: AssetCache) {
    this.keep.addEventListener('change', () => {
      rememberKeep(this.keep.checked);
      void cache.setKeep(this.keep.checked);
    });
    this.clear.addEventListener('click', () => { void cache.clearSaved(); });
    cache.onChange((state) => this.showCache(state));
    this.showCache(cache.state);
  }

  showProgress(progress: AssetProgress): void {
    const text = progressText(progress);
    this.progress.hidden = text === null;
    this.progressLabel.textContent = text ?? '';
    if (progress.totalBytes > 0) {
      this.bar.max = progress.totalBytes;
      this.bar.value = Math.min(progress.receivedBytes, progress.totalBytes);
    } else {
      this.bar.removeAttribute('value'); // no size yet: an indeterminate bar
    }
  }

  private showCache(state: AssetCacheState): void {
    this.keep.disabled = !state.available;
    this.keep.checked = state.available && state.keep;
    this.keepLabel.textContent = keepImagesText(state);
    this.clear.textContent = clearImagesText(state.usedBytes);
    this.clear.disabled = state.usedBytes === 0;
  }
}
