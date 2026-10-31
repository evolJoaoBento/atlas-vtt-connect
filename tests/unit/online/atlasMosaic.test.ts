import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { ASSET_LIMITS } from '../../../src/app/online/assets/assetIds';
import { MAX_SENT_PIXELS, mosaicServiceOf, shrinkWithAtlas, type MosaicService } from '../../../src/app/online/assets/atlasMosaic';
import type { ShrinkTools } from '../../../src/app/online/assets/imageShrink';
import { vaultImageFiles } from '../../../src/app/online/assets/vaultImageFiles';

const MB = 1024 * 1024;

/** Atlas 0.11's tile service, as far as Connect reads it: what it was asked, and the pictures it gives. */
function service(pyramid = { width: 40000, height: 30000 }) {
  const log = { opened: 0, closed: [] as number[], asked: [] as number[] };
  const fake: MosaicService = {
    open: vi.fn(async () => { log.opened += 1; return { handle: 7, pyramid }; }),
    overview: vi.fn(async (_handle: number, side: number) => {
      log.asked.push(side);
      const scale = Math.min(1, side / Math.max(pyramid.width, pyramid.height));
      return { width: Math.round(pyramid.width * scale), height: Math.round(pyramid.height * scale), close: vi.fn() } as unknown as ImageBitmap;
    }),
    close: vi.fn((handle: number) => { log.closed.push(handle); }),
  };
  return { fake, log };
}

/** A window that saves whatever it is given as a few bytes, recording the size it was asked to save at. */
function encoder(saved = 5 * MB) {
  const sizes: number[][] = [];
  const encode: ShrinkTools['encode'] = async (_bitmap, width, height) => { sizes.push([width, height]); return new ArrayBuffer(saved); };
  const tools: ShrinkTools = { decode: async () => { throw new Error('a window is not asked to decode a file'); }, encode };
  return { tools, sizes };
}

const png = (width: number, height: number): ArrayBuffer => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes.buffer;
};

function appWith(atlas: MosaicService | null) {
  const view = atlas ? { renderer: { getMapImage: () => ({ deps: { service: atlas } }) } } : { renderer: { getMapImage: () => null } };
  return { workspace: { getLeavesOfType: (type: string) => (type === 'atlas-vtt' ? [{ view }] : []) } } as unknown as App;
}

describe("Atlas 0.11's tile service", () => {
  it('is found through a map view that has a map image, and is not there without one', () => {
    const { fake } = service();
    expect(mosaicServiceOf(appWith(fake))).toBe(fake);
    expect(mosaicServiceOf(appWith(null))).toBeNull();
    expect(mosaicServiceOf({} as unknown as App)).toBeNull();
    // A view that is still starting: its renderer throws, and the next view is asked.
    const starting = { view: { get renderer(): never { throw new Error('not ready'); } } };
    const ready = { view: { renderer: { getMapImage: () => ({ deps: { service: fake } }) } } };
    expect(mosaicServiceOf({ workspace: { getLeavesOfType: () => [starting, ready] } } as unknown as App)).toBe(fake);
    // A service that lacks a member is not used.
    expect(mosaicServiceOf(appWith({ open: async () => null } as unknown as MosaicService))).toBeNull();
  });
});

describe('a huge map cut down from Atlas\'s tiles', () => {
  const file = (size = 400 * MB) => {
    const map = new (TFile as unknown as new (path: string) => TFile)('maps/vast.png');
    map.stat = { ctime: 0, mtime: 1, size };
    return map;
  };

  it('asks for the size players get, saves it, and lets the map go, never reading the file', async () => {
    const { fake, log } = service();
    const { tools, sizes } = encoder();
    const copy = await shrinkWithAtlas(appWith(fake), file(), 'image/png', tools);
    expect(copy?.byteLength).toBe(5 * MB);
    expect(log.asked).toEqual([8192]);
    expect(sizes).toEqual([[8192, 6144]]);
    expect(log.closed).toEqual([7]);
  });

  it('takes the quick picture when the tiles are not cut in time, and saves it at the size it has', async () => {
    const { fake, log } = service();
    (fake.overview as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    const { tools, sizes } = encoder();
    expect((await shrinkWithAtlas(appWith(fake), file(), 'image/png', tools))?.byteLength).toBe(5 * MB);
    expect(log.asked).toEqual([2048]);
    expect(sizes).toEqual([[2048, 1536]]);
    expect(log.closed).toEqual([7]);
  });

  it('cuts smaller again while the copy is over three quarters of the limit', async () => {
    const { fake, log } = service();
    const { tools } = encoder();
    const saves = [ASSET_LIMITS.fileBytes, 20 * MB];
    const encode: ShrinkTools['encode'] = async () => new ArrayBuffer(saves.shift() ?? 1);
    await shrinkWithAtlas(appWith(fake), file(), 'image/png', { ...tools, encode });
    expect(log.asked).toEqual([8192, 4096]);
  });

  it('gives nothing, for the file to be read as before, without the service, when it cannot open the map, or cannot cut it', async () => {
    const { tools } = encoder();
    expect(await shrinkWithAtlas(appWith(null), file(), 'image/png', tools)).toBeNull();
    const refusing = service();
    (refusing.fake.open as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('cannot decode'));
    expect(await shrinkWithAtlas(appWith(refusing.fake), file(), 'image/png', tools)).toBeNull();
    expect(refusing.log.closed).toEqual([]);
    const failing = service();
    (failing.fake.overview as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('worker stopped'));
    expect(await shrinkWithAtlas(appWith(failing.fake), file(), 'image/png', tools)).toBeNull();
    expect(failing.log.closed).toEqual([7]);
  });
});

describe("the vault's maps with Atlas's tiles", () => {
  function vault(size: number, header: ArrayBuffer | null, atlas: ReturnType<typeof service>['fake'] | null) {
    const file = new (TFile as unknown as new (path: string) => TFile)('maps/vast.png');
    file.stat = { ctime: 0, mtime: 5, size };
    const whole = header ?? new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer;
    const readBinary = vi.fn(async () => whole.slice(0));
    const base = appWith(atlas) as unknown as { workspace: unknown };
    const app = { ...base, vault: { getAbstractFileByPath: (path: string) => (path === file.path ? file : null), readBinary } } as unknown as App;
    const shrink = vi.fn(async (): Promise<ArrayBuffer> => new TextEncoder().encode('read and cut').buffer as ArrayBuffer);
    const { tools } = encoder(100);
    const fromAtlas = vi.fn((target: TFile, mime: string) => shrinkWithAtlas(app, target, mime, tools));
    return { readBinary, shrink, fromAtlas, files: vaultImageFiles(app, shrink, fromAtlas) };
  }

  it('sends a file over the limit as the copy of the tiles, without reading it', async () => {
    const { files, readBinary, shrink } = vault(2000 * MB, null, service().fake);
    expect((await files.read('maps/vast.png')).byteLength).toBe(100);
    expect(readBinary).not.toHaveBeenCalled();
    expect(shrink).not.toHaveBeenCalled();
  });

  it('reads and cuts the file as before where Atlas gives no tiles', async () => {
    const { files, readBinary, shrink } = vault(ASSET_LIMITS.fileBytes + 1, null, null);
    expect(new TextDecoder().decode(await files.read('maps/vast.png'))).toBe('read and cut');
    expect(readBinary).toHaveBeenCalledTimes(1);
    expect(shrink).toHaveBeenCalledTimes(1);
  });

  it('sends a file under the limit that holds more pixels than Atlas held before as the copy too, measured once', async () => {
    const side = Math.ceil(Math.sqrt(MAX_SENT_PIXELS)) + 100;
    const { files, fromAtlas } = vault(30 * MB, png(side, side), service().fake);
    expect((await files.read('maps/vast.png')).byteLength).toBe(100);
    expect((await files.read('maps/vast.png')).byteLength).toBe(100);
    expect(fromAtlas).toHaveBeenCalledTimes(1);
  });

  it('leaves a map of up to 144 megapixels as it is, and a small file unmeasured', async () => {
    const side = Math.floor(Math.sqrt(MAX_SENT_PIXELS));
    const fits = vault(30 * MB, png(side, side), service().fake);
    expect((await fits.files.read('maps/vast.png')).byteLength).toBe(33);
    expect(fits.fromAtlas).not.toHaveBeenCalled();
    const small = vault(2 * MB, png(60000, 60000), service().fake);
    expect((await small.files.read('maps/vast.png')).byteLength).toBe(33);
    expect(small.fromAtlas).not.toHaveBeenCalled();
  });
});
