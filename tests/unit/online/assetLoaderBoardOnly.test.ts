/** Files only Tabletop's 3D board reads (by URL) are handed to the decoder as such: the web page never decodes them. */
import { describe, expect, it, vi } from 'vitest';
import type { StoredImage } from '../../../src/app/online/assets/AssetCache';
import { AssetLoader, type DecodedImage } from '../../../src/app/online/assets/AssetLoader';
import type { BoardExtras } from '../../../src/app/online/scene/boardTypes';
import { decodeAsset, encodeAsset, encodeChunk } from '../../../src/app/online/assets/assetProtocol';
import { fingerprintOf, imageBytes, nodeHash, settle } from './assetFixtures';
import { sceneWithImages } from './sceneFixtures';

function serve(loader: AssetLoader, id: string, handle: number, bytes: Uint8Array): void {
  loader.receive(encodeAsset({ v: 1, type: 'asset-start', id, handle, size: bytes.byteLength, mime: 'image/png' }));
  loader.receive(encodeChunk(handle, bytes));
  loader.receive(encodeAsset({ v: 1, type: 'asset-end', handle }));
}

function boardWith(material: string): BoardExtras {
  return { sceneId: 's', walls: [], lights: [], props: [], materials: [{ id: 'm', scale: 1, maps: { color: material } }], lighting: { enabled: false, ambient: 1, ambientColor: null }, fogHeight: null, wallThickness: null } as unknown as BoardExtras;
}

describe('AssetLoader: files only the 3D board reads', () => {
  it('asks the decoder to skip a material map, and decodes it again once a 2D view draws it too', async () => {
    const map = imageBytes(200, 1);
    const brick = imageBytes(300, 2);
    const store = new Map<string, StoredImage>();
    const uses: Array<[string, boolean]> = [];
    const released: string[] = [];
    const decode = vi.fn(async (bytes: ArrayBuffer, _mime: unknown, use?: { boardOnly: boolean }): Promise<DecodedImage | null> => {
      const id = fingerprintOf(new Uint8Array(bytes));
      uses.push([id, use?.boardOnly === true]);
      return { image: { id } as unknown as ImageBitmap, width: 1, height: 1, ...(use?.boardOnly ? { urlOnly: true } : {}), release: () => released.push(id) };
    });
    const loader = new AssetLoader({
      cache: { get: async (id) => store.get(id) ?? null, put: async (image) => { store.set(image.id, image); } },
      decode, hash: nodeHash, onChange: () => {},
    });
    loader.connected((data) => { void decodeAsset(data); });
    loader.setScene(sceneWithImages(fingerprintOf(map), []));
    loader.setBoard(boardWith(fingerprintOf(brick)));
    await settle();
    serve(loader, fingerprintOf(map), 1, map);
    serve(loader, fingerprintOf(brick), 2, brick);
    await settle();
    expect(uses).toContainEqual([fingerprintOf(map), false]);
    expect(uses).toContainEqual([fingerprintOf(brick), true]);
    expect(loader.image(fingerprintOf(brick))?.urlOnly).toBe(true);
    // The same picture becomes a token's art: the 2D map draws it, so it is decoded from this device's store.
    loader.setScene(sceneWithImages(fingerprintOf(map), [fingerprintOf(brick)]));
    await settle();
    expect(released).toContain(fingerprintOf(brick));
    expect(uses.filter(([id]) => id === fingerprintOf(brick)).at(-1)).toEqual([fingerprintOf(brick), false]);
    expect(loader.image(fingerprintOf(brick))?.urlOnly).toBeUndefined();
  });
});
