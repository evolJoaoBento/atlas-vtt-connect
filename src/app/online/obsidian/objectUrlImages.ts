/**
 * The online scene's image decoder for `AssetLoader`. It checks that the bytes decode as an image,
 * through an `<img>`, which never runs an SVG's scripts. It keeps two object URLs of them: one for
 * the map background and one for token art. Atlas's background cache and token cache each unload a
 * texture by its URL, so a map and a token of the same image never share one. `release` revokes
 * both. The bytes stay in memory; nothing goes to the vault.
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

export async function decodeToObjectUrls(bytes: ArrayBuffer, mime: AssetMime): Promise<UrlImage | null> {
  const blob = new Blob([bytes], { type: mime });
  const urls: ImageUrls = { background: URL.createObjectURL(blob), token: URL.createObjectURL(blob) };
  const revoke = (): void => {
    URL.revokeObjectURL(urls.background);
    URL.revokeObjectURL(urls.token);
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
