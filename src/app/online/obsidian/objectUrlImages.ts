/**
 * The online scene's image decoder for `AssetLoader`. It checks that the bytes decode as an image,
 * through an `<img>`, which never runs an SVG's scripts. It keeps two object URLs of them: one for
 * the map background and one for token art. Atlas's background cache and token cache each unload a
 * texture by its URL, so a map and a token of the same image never share one. `release` revokes
 * both, once no remote view shows them (`shownUrls`): the loader lets go of a scene's images as the
 * next scene arrives, before that scene reaches the view. The bytes stay in memory; nothing goes to the vault.
 */
import type { AssetMime } from '../assets/assetIds';
import type { DecodedImage } from '../assets/AssetLoader';

export interface ImageUrls {
  background: string;
  token: string;
}

export interface UrlImage extends DecodedImage {
  readonly urls: ImageUrls;
}

/**
 * The object URLs each remote view shows, by holder: a URL released while a view still shows it is revoked once
 * the view shows a scene without it, or lets go.
 */
export class ShownUrls {
  private readonly shown = new Map<object, ReadonlySet<string>>();
  private readonly released = new Set<string>();

  /** What `holder` shows now, after its `setScene`. */
  show(holder: object, urls: Iterable<string>): void {
    this.shown.set(holder, new Set(urls));
    this.flush();
  }

  /** `holder` shows nothing any more. */
  drop(holder: object): void {
    this.shown.delete(holder);
    this.flush();
  }

  /** Revokes `url` now, or once no holder shows it. */
  revoke(url: string): void {
    this.released.add(url);
    this.flush();
  }

  private flush(): void {
    for (const url of [...this.released]) {
      if ([...this.shown.values()].some((urls) => urls.has(url))) continue;
      this.released.delete(url);
      URL.revokeObjectURL(url);
    }
  }
}

/** The object URLs Connect's remote views show. */
export const shownUrls = new ShownUrls();

export async function decodeToObjectUrls(bytes: ArrayBuffer, mime: AssetMime): Promise<UrlImage | null> {
  const blob = new Blob([bytes], { type: mime });
  const urls: ImageUrls = { background: URL.createObjectURL(blob), token: URL.createObjectURL(blob) };
  const revoke = (): void => {
    shownUrls.revoke(urls.background);
    shownUrls.revoke(urls.token);
  };
  const image = createEl('img');
  image.decoding = 'async';
  image.src = urls.token;
  try {
    await image.decode();
  } catch {
    revoke();
    return null;
  }
  let released = false;
  return {
    image,
    width: image.naturalWidth || 1,
    height: image.naturalHeight || 1,
    urls,
    release: () => {
      if (released) return;
      released = true;
      revoke();
    },
  };
}

/** The URLs of an image this decoder made; null for none or another decoder's. */
export function urlsOf(image: DecodedImage | null): ImageUrls | null {
  return image !== null && 'urls' in image ? (image as UrlImage).urls : null;
}
