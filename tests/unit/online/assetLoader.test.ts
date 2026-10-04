import { describe, expect, it, vi } from 'vitest';
import type { StoredImage } from '../../../src/app/online/assets/AssetCache';
import { ASSET_LIMITS, type AssetMime } from '../../../src/app/online/assets/assetIds';
import { AssetLoader, type DecodedImage } from '../../../src/app/online/assets/AssetLoader';
import { decodeAsset, encodeAsset, encodeChunk, type AssetMessage } from '../../../src/app/online/assets/assetProtocol';
import { fingerprintOf, imageBytes, nodeHash, settle } from './assetFixtures';
import { sceneWithImages } from './sceneFixtures';

/** The GM end of the assets channel, driven by hand. */
class FakeGm {
  readonly sent: AssetMessage[] = [];
  constructor(private readonly loader: AssetLoader) {}
  connect(): void {
    this.loader.connected((data) => {
      const decoded = decodeAsset(data);
      if (decoded.kind === 'message') this.sent.push(decoded.message);
    });
  }
  requested(): string[] { return this.sent.flatMap((message) => (message.type === 'asset-request' ? message.ids : [])); }
  cancelled(): string[] { return this.sent.flatMap((message) => (message.type === 'asset-cancel' ? message.ids : [])); }
  start(id: string, handle: number, size: number, mime: AssetMime = 'image/png'): void {
    this.loader.receive(encodeAsset({ v: 1, type: 'asset-start', id, handle, size, mime }));
  }
  chunks(handle: number, bytes: Uint8Array, from = 0, to = bytes.byteLength): void {
    for (let offset = from; offset < to; offset += ASSET_LIMITS.chunkBytes) {
      this.loader.receive(encodeChunk(handle, bytes.subarray(offset, Math.min(offset + ASSET_LIMITS.chunkBytes, to))));
    }
  }
  end(handle: number): void { this.loader.receive(encodeAsset({ v: 1, type: 'asset-end', handle })); }
  serve(id: string, handle: number, bytes: Uint8Array): void {
    this.start(id, handle, bytes.byteLength);
    this.chunks(handle, bytes);
    this.end(handle);
  }
  deny(id: string): void { this.loader.receive(encodeAsset({ v: 1, type: 'asset-denied', id })); }
}

function setup(stored: Uint8Array[] = [], undecodable: string[] = []) {
  const cache = new Map<string, StoredImage>(stored.map((bytes) => {
    const id = fingerprintOf(bytes);
    return [id, { id, mime: 'image/png', bytes: bytes.slice().buffer }];
  }));
  const cacheApi = {
    get: vi.fn(async (id: string): Promise<StoredImage | null> => cache.get(id) ?? null),
    put: vi.fn(async (image: StoredImage): Promise<void> => { cache.set(image.id, image); }),
  };
  const released: string[] = [];
  const decode = vi.fn(async (bytes: ArrayBuffer): Promise<DecodedImage | null> => {
    const id = fingerprintOf(new Uint8Array(bytes));
    if (undecodable.includes(id)) return null;
    return { image: { id } as unknown as ImageBitmap, width: 10, height: 10, release: () => released.push(id) };
  });
  let changes = 0;
  const loader = new AssetLoader({ cache: cacheApi, decode, hash: nodeHash, onChange: () => { changes++; } });
  return { loader, gm: new FakeGm(loader), cache, cacheApi, decode, released, changes: () => changes };
}

describe('AssetLoader', () => {
  it('loads images this device has and requests the rest together, the map first', async () => {
    const map = imageBytes(500, 1);
    const kept = imageBytes(300, 2);
    const tokens = Array.from({ length: 70 }, (_, index) => imageBytes(20, 10 + index));
    const h = setup([kept]);
    h.gm.connect();
    h.loader.setScene(sceneWithImages(fingerprintOf(map), [fingerprintOf(kept), ...tokens.map((bytes) => fingerprintOf(bytes))]));
    await settle();
    const requests = h.gm.sent.filter((message) => message.type === 'asset-request');
    expect(requests.map((message) => (message.type === 'asset-request' ? message.ids.length : 0))).toEqual([64, 7]);
    expect(h.gm.requested()[0]).toBe(fingerprintOf(map));
    expect(h.gm.requested()).not.toContain(fingerprintOf(kept));
    expect(h.loader.image(fingerprintOf(kept))?.image).toEqual({ id: fingerprintOf(kept) });
    expect(h.cacheApi.put).not.toHaveBeenCalled(); // it came from the cache
  });

  it('asks for an image once however many tokens show it', async () => {
    const art = imageBytes(100);
    const id = fingerprintOf(art);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(id, [id, id, id]));
    await settle();
    expect(h.gm.requested()).toEqual([id]);
    h.gm.serve(id, 1, art);
    await settle();
    expect(h.loader.image(id)).not.toBeNull();
    expect(h.decode).toHaveBeenCalledTimes(1);
  });

  it('requests nothing before it is connected, and everything it lacks once connected', async () => {
    const art = imageBytes(100);
    const h = setup();
    h.loader.setScene(sceneWithImages(null, [fingerprintOf(art)]));
    await settle();
    h.gm.connect();
    expect(h.gm.requested()).toEqual([fingerprintOf(art)]);
  });

  it('keeps at most 256 images outstanding and asks for more as they arrive', async () => {
    const arts = Array.from({ length: 300 }, (_, index) => imageBytes(8, index + 1));
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(null, arts.map((bytes) => fingerprintOf(bytes))));
    await settle();
    expect(h.gm.requested()).toHaveLength(ASSET_LIMITS.pendingPerPlayer);
    h.gm.serve(fingerprintOf(arts[0]!), 1, arts[0]!);
    expect(h.gm.requested()).toHaveLength(ASSET_LIMITS.pendingPerPlayer + 1);
  });

  it('assembles an image from its chunks, checks it, keeps it and reports progress', async () => {
    const map = imageBytes(150_000);
    const id = fingerprintOf(map);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(id, []));
    await settle();
    expect(h.loader.progress()).toEqual({ outstanding: 1, receivedBytes: 0, totalBytes: 0 });
    h.gm.start(id, 7, map.byteLength);
    h.gm.chunks(7, map, 0, 65_536);
    expect(h.loader.progress()).toEqual({ outstanding: 1, receivedBytes: 65_536, totalBytes: 150_000 });
    h.gm.chunks(7, map, 65_536);
    h.gm.end(7);
    await settle();
    expect(h.loader.progress()).toEqual({ outstanding: 0, receivedBytes: 0, totalBytes: 0 });
    expect(h.loader.image(id)?.image).toEqual({ id });
    expect(new Uint8Array(h.cache.get(id)?.bytes ?? new ArrayBuffer(0))).toEqual(map);
    expect(h.changes()).toBeGreaterThan(2);
  });

  it('never assembles more than announced, and asks once more after a broken transfer', async () => {
    const art = imageBytes(1000);
    const id = fingerprintOf(art);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(null, [id]));
    await settle();
    h.gm.start(id, 1, 500); // announces less than it sends
    h.gm.chunks(1, art);
    expect(h.gm.cancelled()).toEqual([id]);
    expect(h.gm.requested()).toEqual([id, id]);

    h.gm.serve(id, 2, imageBytes(1000, 99)); // other bytes: they fail the fingerprint
    await settle();
    expect(h.loader.image(id)).toBeNull();
    expect(h.gm.requested()).toEqual([id, id]); // refused now: not asked again
    expect(h.loader.progress().outstanding).toBe(0);
    expect(h.cacheApi.put).not.toHaveBeenCalled();
  });

  it('ignores starts it did not ask for and chunks of transfers it was not told about', async () => {
    const other = imageBytes(5, 5);
    const h = setup();
    h.gm.connect();
    h.gm.serve(fingerprintOf(other), 3, other); // never requested
    h.gm.chunks(99, imageBytes(10)); // unknown handle
    await settle();
    expect(h.loader.image(fingerprintOf(other))).toBeNull();
    expect(h.decode).not.toHaveBeenCalled();
  });

  it('cancels images the scene stops using, and asks again for a denied one only after it left and came back', async () => {
    const a = fingerprintOf(imageBytes(10, 1));
    const b = fingerprintOf(imageBytes(10, 2));
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(a, [b]));
    await settle();
    expect(h.gm.requested()).toEqual([a, b]);
    h.gm.deny(b);
    h.loader.setScene(sceneWithImages(a, [b])); // still there: not asked again
    await settle();
    expect(h.gm.requested()).toEqual([a, b]);

    h.loader.setScene(sceneWithImages(null, [b])); // the map leaves while requested
    expect(h.gm.cancelled()).toEqual([a]);
    h.loader.setScene(sceneWithImages(null, [])); // b leaves: it was refused, nothing to cancel
    expect(h.gm.cancelled()).toEqual([a]);
    h.loader.setScene(sceneWithImages(null, [b])); // and comes back
    await settle();
    expect(h.gm.requested()).toEqual([a, b, b]);
  });

  it('does not ask again for an image that does not decode', async () => {
    const art = imageBytes(100);
    const id = fingerprintOf(art);
    const h = setup([], [id]);
    h.gm.connect();
    h.loader.setScene(sceneWithImages(null, [id]));
    await settle();
    h.gm.serve(id, 1, art);
    await settle();
    expect(h.loader.image(id)).toBeNull();
    for (let patch = 0; patch < 3; patch++) h.loader.setScene(sceneWithImages(null, [id]));
    await settle();
    expect(h.gm.requested()).toEqual([id]);
    expect(h.loader.progress().outstanding).toBe(0);
    expect(h.cacheApi.put).not.toHaveBeenCalled();
  });

  it('drops partial images on a disconnect and asks for what it lacks after reconnecting', async () => {
    const map = imageBytes(200_000, 1);
    const token = imageBytes(100, 2);
    const mapId = fingerprintOf(map);
    const tokenId = fingerprintOf(token);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(mapId, [tokenId]));
    await settle();
    h.gm.serve(tokenId, 2, token);
    await settle();
    h.gm.start(mapId, 1, map.byteLength);
    h.gm.chunks(1, map, 0, 65_536);

    h.loader.disconnected();
    expect(h.loader.progress()).toEqual({ outstanding: 1, receivedBytes: 0, totalBytes: 0 });
    const before = h.gm.sent.length;
    h.gm.connect(); // a new link: the GM starts over
    expect(h.gm.sent.slice(before)).toEqual([{ v: 1, type: 'asset-request', ids: [mapId] }]);
    h.gm.chunks(1, map, 65_536); // late chunks of the old transfer are ignored
    h.gm.end(1);
    h.gm.serve(mapId, 1, map); // the new link numbers its transfers from 1 again
    await settle();
    expect(new Uint8Array(h.cache.get(mapId)?.bytes ?? new ArrayBuffer(0))).toEqual(map);
    expect(h.loader.image(tokenId)).not.toBeNull();
  });

  it('checks cached images too, and asks the GM for one that does not match', async () => {
    const art = imageBytes(100);
    const id = fingerprintOf(art);
    const h = setup();
    h.cache.set(id, { id, mime: 'image/png', bytes: imageBytes(100, 7).slice().buffer }); // tampered with
    h.gm.connect();
    h.loader.setScene(sceneWithImages(null, [id]));
    await settle();
    expect(h.gm.requested()).toEqual([id]);
    expect(h.decode).not.toHaveBeenCalled();
  });

  it('releases images the scene no longer shows, and everything when disposed', async () => {
    const a = imageBytes(10, 1);
    const b = imageBytes(10, 2);
    const h = setup([a, b]);
    h.loader.setScene(sceneWithImages(fingerprintOf(a), [fingerprintOf(b)]));
    await settle();
    h.loader.setScene(sceneWithImages(null, [fingerprintOf(b)]));
    expect(h.released).toEqual([fingerprintOf(a)]);
    expect(h.loader.image(fingerprintOf(a))).toBeNull();
    h.loader.dispose();
    expect(h.released).toEqual([fingerprintOf(a), fingerprintOf(b)]);
    expect(h.loader.image(fingerprintOf(b))).toBeNull();
  });

  it('survives a stale denial that arrives after the image left and came back', async () => {
    const art = imageBytes(100, 3);
    const id = fingerprintOf(art);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(null, [id]));
    await settle();
    h.loader.setScene(sceneWithImages(null, [])); // leaves while requested
    h.loader.setScene(sceneWithImages(null, [id])); // and comes back
    await settle();
    expect(h.gm.cancelled()).toEqual([id]);
    h.gm.deny(id); // the old request's denial, queued behind chunks
    expect(h.gm.requested()).toEqual([id, id, id]);
    h.gm.serve(id, 1, art);
    await settle();
    expect(h.loader.image(id)).not.toBeNull();
  });

  it('cancels a transfer announced for an image it does not want', () => {
    const art = imageBytes(100, 4);
    const h = setup();
    h.gm.connect();
    h.gm.start(fingerprintOf(art), 1, art.byteLength);
    expect(h.gm.cancelled()).toEqual([fingerprintOf(art)]);
  });

  it('does not start over when the same link is announced twice', async () => {
    const map = imageBytes(150_000, 5);
    const id = fingerprintOf(map);
    const h = setup();
    let link: ((data: string) => void) | null = null;
    h.loader.connected((link = (): void => {}));
    h.loader.setScene(sceneWithImages(id, []));
    await settle();
    h.loader.receive(encodeAsset({ v: 1, type: 'asset-start', id, handle: 1, size: map.byteLength, mime: 'image/png' }));
    h.loader.receive(encodeChunk(1, map.subarray(0, 1000)));
    h.loader.connected(link);
    expect(h.loader.progress().receivedBytes).toBe(1000);
  });

  it('never shows negative or oversized progress when a check fails after the bar reset', async () => {
    const real = imageBytes(200_000, 6);
    const id = fingerprintOf(real);
    const broken = imageBytes(200_000, 7);
    const h = setup();
    h.gm.connect();
    h.loader.setScene(sceneWithImages(id, []));
    await settle();
    // The last transfer ends, so the bar resets at once; its fingerprint check fails a moment later.
    h.gm.serve(id, 1, broken);
    await settle();
    const afterFailure = h.loader.progress();
    expect(afterFailure.receivedBytes).toBeGreaterThanOrEqual(0);
    expect(afterFailure.receivedBytes).toBeLessThanOrEqual(afterFailure.totalBytes);
    expect(afterFailure).toEqual({ outstanding: 1, receivedBytes: 0, totalBytes: 0 });
    h.gm.serve(id, 2, real);
    await settle();
    expect(h.loader.image(id)).not.toBeNull();
    expect(h.loader.progress()).toEqual({ outstanding: 0, receivedBytes: 0, totalBytes: 0 });
  });
});
