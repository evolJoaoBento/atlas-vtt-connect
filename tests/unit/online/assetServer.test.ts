import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { ASSET_LIMITS } from '../../../src/app/online/assets/assetIds';
import { decodeAsset, encodeAsset, encodeChunk, type AssetChunk, type AssetMessage } from '../../../src/app/online/assets/assetProtocol';
import { AssetServer } from '../../../src/app/online/assets/AssetServer';
import type { AssetFile } from '../../../src/app/online/scene/AssetRegistry';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import type { ChannelPort } from '../../../src/app/online/transport/types';
import { imageBytes, settle } from './assetFixtures';
import { fingerprint as fp, sceneWithImages } from './sceneFixtures';

const MB = 1024 * 1024;

/** Byte equality for large files: `toEqual` walks multi-megabyte arrays element by element, far too slowly. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(b);
}

/** A player's assets channel; when `paced`, chunk bytes stay buffered until `drain`. */
class FakePort implements ChannelPort {
  readonly sent: Array<string | ArrayBuffer> = [];
  paced = false;
  buffered = 0;
  threshold = -1;
  private readonly drains = new Set<() => void>();
  private readonly closes = new Set<() => void>();

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
    if (this.paced && typeof data !== 'string') this.buffered += data.byteLength;
  }
  bufferedAmount(): number { return this.buffered; }
  onDrain(threshold: number, cb: () => void): () => void {
    this.threshold = threshold;
    this.drains.add(cb);
    return () => { this.drains.delete(cb); };
  }
  onClose(cb: () => void): () => void {
    this.closes.add(cb);
    return () => { this.closes.delete(cb); };
  }
  drain(): void {
    this.buffered = 0;
    [...this.drains].forEach((cb) => cb());
  }
  listening(): number { return this.drains.size + this.closes.size; }
  close(): void { [...this.closes].forEach((cb) => cb()); }

  messages(): AssetMessage[] {
    return this.sent.flatMap((data) => { const decoded = decodeAsset(data); return decoded.kind === 'message' ? [decoded.message] : []; });
  }
  chunks(handle?: number): AssetChunk[] {
    return this.sent.flatMap((data) => {
      const decoded = decodeAsset(data);
      return decoded.kind === 'chunk' && (handle === undefined || decoded.chunk.handle === handle) ? [decoded.chunk] : [];
    });
  }
  /** Message types, with the fingerprint for starts and denials. */
  types(): string[] {
    return this.messages().map((message) => (message.type === 'asset-start' || message.type === 'asset-denied' ? `${message.type}:${message.id}` : message.type));
  }
  /** The bytes this player got for `id`, joined from its chunks. */
  bytesOf(id: string): Uint8Array {
    const start = this.messages().find((message) => message.type === 'asset-start' && message.id === id);
    if (!start || start.type !== 'asset-start') return new Uint8Array(0);
    const parts = this.chunks(start.handle);
    const joined = new Uint8Array(parts.reduce((total, chunk) => total + chunk.bytes.byteLength, 0));
    let offset = 0;
    for (const chunk of parts) { joined.set(chunk.bytes, offset); offset += chunk.bytes.byteLength; }
    return joined;
  }
}

const who = (playerId: string): SessionPlayer => ({ playerId, name: playerId, status: 'admitted' });

function setup(scene: PlayerScene | null, files: Record<string, Uint8Array> = {}, readWith?: (id: string) => Promise<AssetFile | null>) {
  const ports = new Map<string, FakePort>();
  const handlers: SessionHandler[] = [];
  const session = {
    use: (handler: SessionHandler): (() => void) => { handlers.push(handler); return () => { handlers.splice(handlers.indexOf(handler), 1); }; },
    assetChannel: (playerId: string): ChannelPort | null => ports.get(playerId) ?? null,
  };
  let current = scene;
  const listeners = new Set<(next: PlayerScene | null) => void>();
  const projection = {
    currentProjection: (): PlayerScene | null => current,
    onProjection: (listener: (next: PlayerScene | null) => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const read = vi.fn(readWith ?? (async (id: string): Promise<AssetFile | null> => {
    const bytes = files[id];
    return bytes ? { bytes: bytes.slice().buffer, mime: 'image/png' } : null;
  }));
  const server = new AssetServer({ session, projection, files: { read } });
  server.start();
  const send = (playerId: string, data: unknown): void => handlers.forEach((handler) => handler.onAssetData?.(who(playerId), data));
  return {
    server, read, handlers, held: (): number => server['reads']['entries'].size,
    player: (playerId: string): FakePort => { const port = new FakePort(); ports.set(playerId, port); return port; },
    request: (playerId: string, ids: string[]): void => send(playerId, encodeAsset({ v: 1, type: 'asset-request', ids })),
    cancel: (playerId: string, ids: string[]): void => send(playerId, encodeAsset({ v: 1, type: 'asset-cancel', ids })),
    send,
    show: (next: PlayerScene | null): void => { current = next; listeners.forEach((listener) => listener(next)); },
  };
}

describe('AssetServer', () => {
  it('serves only images of the scene players have', async () => {
    const h = setup(null, { [fp(1)]: imageBytes(100), [fp(2)]: imageBytes(200, 2) });
    const anna = h.player('anna');
    h.request('anna', [fp(1)]);
    expect(anna.types()).toEqual([`asset-denied:${fp(1)}`]); // nothing is presented yet

    h.show(sceneWithImages(fp(1), [fp(2)]));
    h.request('anna', [fp(2), fp(3)]);
    await settle();
    expect(anna.types()).toEqual([`asset-denied:${fp(1)}`, `asset-denied:${fp(3)}`, `asset-start:${fp(2)}`, 'asset-end']);
    expect(anna.messages()).toContainEqual({ v: 1, type: 'asset-start', id: fp(2), handle: 1, size: 200, mime: 'image/png' });
    expect(anna.bytesOf(fp(2))).toEqual(imageBytes(200, 2));
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it('sends one image at a time per player, the map first, in chunks that make 64 KiB frames', async () => {
    const files = { [fp(1)]: imageBytes(150_000, 1), [fp(2)]: imageBytes(10, 2), [fp(3)]: imageBytes(10, 3) };
    const h = setup(sceneWithImages(fp(1), [fp(2), fp(3)]), files);
    const anna = h.player('anna');
    h.request('anna', [fp(2), fp(1), fp(3)]);
    expect(h.read.mock.calls).toEqual([[fp(1)]]); // only the first image is read yet
    await settle();
    expect(anna.types()).toEqual([
      `asset-start:${fp(1)}`, 'asset-end', `asset-start:${fp(2)}`, 'asset-end', `asset-start:${fp(3)}`, 'asset-end',
    ]);
    expect(anna.chunks(1).map((chunk) => chunk.bytes.byteLength)).toEqual([65_532, 65_532, 18_936]);
    expect(anna.sent.slice(0, 2).map((data) => (typeof data === 'string' ? 0 : data.byteLength))).toEqual([0, 65_536]); // handle + payload
    expect(anna.bytesOf(fp(1))).toEqual(files[fp(1)]);
    expect(anna.bytesOf(fp(3))).toEqual(files[fp(3)]);
  });

  it('pauses on a full buffer and resumes when it drains', async () => {
    const big = imageBytes(3 * MB);
    const h = setup(sceneWithImages(fp(1), [fp(2)]), { [fp(1)]: big, [fp(2)]: imageBytes(10, 2) });
    const anna = h.player('anna');
    anna.paced = true;
    h.request('anna', [fp(1), fp(2)]);
    await settle();
    expect(anna.threshold).toBe(ASSET_LIMITS.lowWaterBytes);
    expect(anna.chunks()).toHaveLength(16); // 1 MB
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`]);

    anna.drain();
    expect(anna.chunks()).toHaveLength(32);
    anna.drain();
    expect(anna.chunks()).toHaveLength(48);
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`]); // 3 MB is 49 chunks of 65 532 bytes
    anna.drain();
    expect(anna.chunks()).toHaveLength(49);
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end']);
    await settle();
    // One chunk is buffered, far below the high-water mark: the next image goes straight out.
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end', `asset-start:${fp(2)}`, 'asset-end']);
    expect(sameBytes(anna.bytesOf(fp(1)), big)).toBe(true);
  });

  it('reads a file once for every player who needs it, and lets it go after', async () => {
    const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(1000) });
    const anna = h.player('anna');
    const ben = h.player('ben');
    h.request('anna', [fp(1)]);
    h.request('ben', [fp(1)]);
    await settle();
    expect(h.read).toHaveBeenCalledTimes(1);
    expect(anna.bytesOf(fp(1))).toEqual(imageBytes(1000));
    expect(ben.bytesOf(fp(1))).toEqual(imageBytes(1000));

    h.request('anna', [fp(1)]); // asked again later: nobody held it, so it is read again
    await settle();
    expect(h.read).toHaveBeenCalledTimes(2);
  });

  it('keeps file bytes only for images a transfer is sending, not for queued ones', async () => {
    const ids = [fp(1), fp(2), fp(3), fp(4)];
    const files = Object.fromEntries(ids.map((id, index) => [id, imageBytes(1000, index + 1)]));
    const h = setup(sceneWithImages(ids[0]!, ids.slice(1)), files);
    const anna = h.player('anna');
    const ben = h.player('ben');
    ben.paced = true;
    ben.buffered = ASSET_LIMITS.highWaterBytes; // ben's connection stalls: he never gets past his first image
    h.request('ben', ids);
    h.request('anna', ids);
    await settle();
    expect(anna.types().filter((type) => type === 'asset-end')).toHaveLength(4);
    expect(ben.types()).toEqual([`asset-start:${ids[0]}`]);
    expect(h.held()).toBe(1); // only ben's current image
  });

  it('queues at most 256 images per player and ignores duplicates', () => {
    const ids = Array.from({ length: 300 }, (_, index) => fp(index + 1));
    const h = setup(sceneWithImages(null, ids), Object.fromEntries(ids.map((id, index) => [id, imageBytes(10, index + 1)])));
    const anna = h.player('anna');
    anna.paced = true;
    anna.buffered = ASSET_LIMITS.highWaterBytes; // nothing leaves: everything stays queued
    for (let start = 0; start < ids.length; start += ASSET_LIMITS.idsPerMessage) h.request('anna', ids.slice(start, start + ASSET_LIMITS.idsPerMessage));
    h.request('anna', [ids[0]!, ids[1]!]);
    const denied = anna.messages().flatMap((message) => (message.type === 'asset-denied' ? [message.id] : []));
    expect(denied).toEqual(ids.slice(256));
  });

  it('stops an image that leaves the scene, and drops queued ones silently', async () => {
    const h = setup(sceneWithImages(fp(1), [fp(2), fp(3)]), {
      [fp(1)]: imageBytes(3 * MB), [fp(2)]: imageBytes(10, 2), [fp(3)]: imageBytes(10, 3),
    });
    const anna = h.player('anna');
    anna.paced = true;
    h.request('anna', [fp(1), fp(2), fp(3)]);
    await settle();
    expect(anna.chunks(1)).toHaveLength(16);

    h.show(sceneWithImages(null, [fp(3)])); // the map and the first token are gone
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, `asset-denied:${fp(1)}`]);
    anna.drain();
    await settle();
    expect(anna.chunks(1)).toHaveLength(16); // nothing more of the map
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, `asset-denied:${fp(1)}`, `asset-start:${fp(3)}`, 'asset-end']);

    h.show(null); // presenting stopped
    h.request('anna', [fp(3)]);
    expect(anna.types().at(-1)).toBe(`asset-denied:${fp(3)}`);
  });

  it('cancels one player\'s images on request, without a reply and without touching others', async () => {
    const big = imageBytes(3 * MB);
    const h = setup(sceneWithImages(fp(1), [fp(2)]), { [fp(1)]: big, [fp(2)]: imageBytes(10, 2) });
    const anna = h.player('anna');
    const ben = h.player('ben');
    anna.paced = true;
    h.request('anna', [fp(1), fp(2)]);
    h.request('ben', [fp(1)]);
    await settle();
    h.cancel('anna', [fp(1)]);
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`]);
    anna.drain();
    await settle();
    expect(anna.chunks(1)).toHaveLength(16);
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, `asset-start:${fp(2)}`, 'asset-end']);
    expect(sameBytes(ben.bytesOf(fp(1)), big)).toBe(true);
  });

  it('denies an image whose file became unreadable or changed, and goes on', async () => {
    const h = setup(sceneWithImages(fp(1), [fp(2)]), { [fp(1)]: imageBytes(10) });
    const anna = h.player('anna');
    h.request('anna', [fp(2), fp(1)]);
    await settle();
    expect(anna.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end', `asset-denied:${fp(2)}`]);
  });

  it('drops a player\'s queue when their channel closes, and serves only players with a channel', async () => {
    const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(3 * MB) });
    const anna = h.player('anna');
    anna.paced = true;
    h.request('anna', [fp(1)]);
    await settle();
    anna.close();
    anna.drain();
    expect(anna.chunks()).toHaveLength(16);

    h.request('stranger', [fp(1)]); // not admitted: no assets channel
    await settle();
    expect(h.read).toHaveBeenCalledTimes(1);

    const annaAgain = h.player('anna'); // a new tab or a reconnect starts from an empty queue
    h.request('anna', [fp(1)]);
    await settle();
    expect(annaAgain.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end']);

    const benPort = h.player('ben');
    benPort.paced = true;
    h.request('ben', [fp(1)]);
    await settle();
    h.server.onGone(who('ben'));
    benPort.drain();
    expect(benPort.chunks()).toHaveLength(16);
  });

  it('ignores anything but requests and cancels', async () => {
    const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(10) });
    const anna = h.player('anna');
    h.send('anna', encodeChunk(1, new Uint8Array(4)));
    h.send('anna', 'junk');
    h.send('anna', encodeAsset({ v: 1, type: 'asset-start', id: fp(1), handle: 1, size: 10, mime: 'image/png' }));
    h.send('anna', encodeAsset({ v: 1, type: 'asset-denied', id: fp(1) }));
    await settle();
    expect(anna.sent).toEqual([]);
    expect(h.read).not.toHaveBeenCalled();
  });

  it('stops serving when stopped', async () => {
    const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(3 * MB) });
    const anna = h.player('anna');
    anna.paced = true;
    h.request('anna', [fp(1)]);
    await settle();
    h.server.stop();
    expect(h.handlers).toEqual([]);
    anna.drain();
    expect(anna.chunks()).toHaveLength(16);
  });

  describe('hardening', () => {
    const later = (): { read: (id: string) => Promise<AssetFile | null>; finish: (bytes: Uint8Array) => void } => {
      let resolve: (file: AssetFile | null) => void = () => undefined;
      const promise = new Promise<AssetFile | null>((ok) => { resolve = ok; });
      return {
        read: () => promise,
        finish: (bytes) => resolve({ bytes: bytes.slice().buffer, mime: 'image/png' }),
      };
    };

    it('sends nothing when a read resolves after the image left the scene', async () => {
      const slow = later();
      const h = setup(sceneWithImages(fp(1), []), {}, slow.read);
      const anna = h.player('anna');
      h.request('anna', [fp(1)]);
      h.show(sceneWithImages(null, []));
      expect(anna.types()).toEqual([`asset-denied:${fp(1)}`]);
      slow.finish(imageBytes(10));
      await settle();
      expect(anna.types()).toEqual([`asset-denied:${fp(1)}`]);
      expect(h.held()).toBe(0);
    });

    it('sends nothing when a read resolves after the player is gone or the server stopped', async () => {
      const slow = later();
      const h = setup(sceneWithImages(fp(1), []), {}, slow.read);
      const anna = h.player('anna');
      const ben = h.player('ben');
      h.request('anna', [fp(1)]);
      h.request('ben', [fp(1)]);
      h.server.onGone(who('anna'));
      slow.finish(imageBytes(10));
      await settle();
      expect(anna.sent).toEqual([]);
      expect(ben.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end']);
      expect(h.held()).toBe(0);

      const slowAgain = later();
      const h2 = setup(sceneWithImages(fp(1), []), {}, slowAgain.read);
      const carl = h2.player('carl');
      h2.request('carl', [fp(1)]);
      h2.server.stop();
      slowAgain.finish(imageBytes(10));
      await settle();
      expect(carl.sent).toEqual([]);
      expect(h2.held()).toBe(0);
    });

    it('denies an image whose read fails, and goes on with the next', async () => {
      const files: Record<string, Uint8Array> = { [fp(2)]: imageBytes(10, 2) };
      const h = setup(sceneWithImages(fp(1), [fp(2)]), files, (id) => (
        id === fp(1) ? Promise.reject(new Error('boom')) : Promise.resolve({ bytes: files[id]!.slice().buffer, mime: 'image/png' })
      ));
      const anna = h.player('anna');
      h.request('anna', [fp(1), fp(2)]);
      await settle();
      expect(anna.types()).toEqual([`asset-denied:${fp(1)}`, `asset-start:${fp(2)}`, 'asset-end']);
      expect(h.held()).toBe(0);
    });

    it('denies an empty file', async () => {
      const h = setup(sceneWithImages(fp(1), []), {}, () => Promise.resolve({ bytes: new ArrayBuffer(0), mime: 'image/png' }));
      const anna = h.player('anna');
      h.request('anna', [fp(1)]);
      await settle();
      expect(anna.types()).toEqual([`asset-denied:${fp(1)}`]);
    });

    it('does not release a hold twice when the channel closes while the end is sent', async () => {
      const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(10) });
      const anna = h.player('anna');
      const ben = h.player('ben');
      const send = anna.send.bind(anna);
      let heldWhenBenIsServed = -1;
      anna.send = (data): void => { send(data); if (typeof data === 'string' && data.includes('asset-end')) anna.close(); };
      const benSend = ben.send.bind(ben);
      ben.send = (data): void => { if (heldWhenBenIsServed < 0) heldWhenBenIsServed = h.held(); benSend(data); };
      h.request('anna', [fp(1)]);
      h.request('ben', [fp(1)]);
      await settle();
      expect(heldWhenBenIsServed).toBe(1); // anna's close released her hold once; ben still holds the file
      expect(ben.types()).toEqual([`asset-start:${fp(1)}`, 'asset-end']);
      expect(h.held()).toBe(0);
    });

    it('moves a queued image that becomes the map to the front', async () => {
      const h = setup(sceneWithImages(fp(1), [fp(2), fp(3)]), {
        [fp(1)]: imageBytes(3 * MB), [fp(2)]: imageBytes(10, 2), [fp(3)]: imageBytes(10, 3),
      });
      const anna = h.player('anna');
      anna.paced = true;
      h.request('anna', [fp(1), fp(2), fp(3)]); // fp(1) is in flight and blocked on the buffer
      await settle();
      h.show(sceneWithImages(fp(3), [fp(1), fp(2)]));
      anna.drain();
      anna.drain();
      anna.drain();
      await settle();
      anna.drain();
      await settle();
      const starts = anna.types().filter((type) => type.startsWith('asset-start'));
      expect(starts).toEqual([`asset-start:${fp(1)}`, `asset-start:${fp(3)}`, `asset-start:${fp(2)}`]);
    });

    it('stop removes the port listeners', async () => {
      const h = setup(sceneWithImages(fp(1), []), { [fp(1)]: imageBytes(10) });
      const anna = h.player('anna');
      h.request('anna', [fp(1)]);
      await settle();
      expect(anna.listening()).toBe(2);
      h.server.stop();
      expect(anna.listening()).toBe(0);
    });
  });
});
