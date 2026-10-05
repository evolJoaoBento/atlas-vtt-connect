import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeToObjectUrls, urlsOf } from '../../../../src/app/online/obsidian/objectUrlImages';

const created: string[] = [];
const revoked: string[] = [];
let decodes = true;

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  decodes = true;
  let next = 0;
  // jsdom has no object URLs and no image decoding.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true, writable: true, value: vi.fn(() => { const url = `blob:test/${++next}`; created.push(url); return url; }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn((url: string) => { revoked.push(url); }) });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true, writable: true, value: vi.fn(() => (decodes ? Promise.resolve() : Promise.reject(new Error('bad image')))),
  });
});

afterEach(() => {
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).decode;
});

describe('decodeToObjectUrls', () => {
  it('keeps one URL for the map and another for tokens, and revokes both once on release', async () => {
    const image = await decodeToObjectUrls(new ArrayBuffer(8), 'image/png');
    const urls = urlsOf(image);
    expect(urls).not.toBeNull();
    expect(urls?.background).not.toBe(urls?.token);
    expect(created).toEqual([urls?.background, urls?.token]);
    image?.release();
    image?.release();
    expect(revoked.sort()).toEqual([...created].sort());
  });

  it('refuses bytes that do not decode, and keeps no URL of them', async () => {
    decodes = false;
    expect(await decodeToObjectUrls(new ArrayBuffer(8), 'image/svg+xml')).toBeNull();
    expect(revoked.sort()).toEqual([...created].sort());
  });

  it('finds no URLs on an image another decoder made', () => {
    expect(urlsOf({ image: {} as HTMLImageElement, width: 1, height: 1, release: () => {} })).toBeNull();
    expect(urlsOf(null)).toBeNull();
  });
});
