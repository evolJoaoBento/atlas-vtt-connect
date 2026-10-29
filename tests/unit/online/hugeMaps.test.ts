import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { ASSET_LIMITS, isRasterMime } from '../../../src/app/online/assets/assetIds';
import { shrinkImage, shrunkSize, SHRUNK_LONGEST_SIDE, type ShrinkTools } from '../../../src/app/online/assets/imageShrink';
import { vaultImageFiles } from '../../../src/app/online/assets/vaultImageFiles';
import { AssetRegistry, IMAGE_REDUCED_NOTICE, IMAGE_TOO_LARGE_NOTICE, type ImageFiles } from '../../../src/app/online/scene/AssetRegistry';
import { fingerprintOf, nodeHash, settle } from './assetFixtures';

const MB = 1024 * 1024;

describe('a smaller copy of a map too large to send', () => {
  it('keeps the shape and cuts the longer side, and leaves a smaller image as it is', () => {
    expect(shrunkSize(12000, 12000)).toEqual({ width: SHRUNK_LONGEST_SIDE, height: SHRUNK_LONGEST_SIDE });
    expect(shrunkSize(16000, 9000)).toEqual({ width: 8192, height: 4608 });
    expect(shrunkSize(9000, 16000)).toEqual({ width: 4608, height: 8192 });
    expect(shrunkSize(4000, 3000)).toEqual({ width: 4000, height: 3000 });
    expect(shrunkSize(100_000, 1)).toEqual({ width: 8192, height: 1 });
  });

  /** What a window gives it: a decode at a size, and a WebP of the result. `savedBytes` is the size of each round's file. */
  function tools(savedBytes: number[]) {
    const log = { decoded: [] as number[][], closed: 0, rounds: 0 };
    const kit: ShrinkTools = {
      decode: async (_blob, width, height) => { log.decoded.push([width, height]); return { width, height, close: () => { log.closed += 1; } }; },
      encode: async () => {
        const size = savedBytes[log.rounds++] ?? savedBytes.at(-1)!;
        return size > 0 ? new ArrayBuffer(size) : null;
      },
    };
    return { kit, log };
  }
  const header = async () => ({ width: 12000, height: 8000 });

  it('decodes at the cut size, never the whole image, and sends the first copy that fits', async () => {
    const { kit, log } = tools([20 * MB]);
    const copy = await shrinkImage(new ArrayBuffer(100), 'image/png', kit, header);
    expect(copy.byteLength).toBe(20 * MB);
    expect(log.decoded).toEqual([[8192, 5461]]);
    expect(log.closed).toBe(1);
  });

  it('cuts it smaller again while the copy is still over three quarters of the limit, and gives up after a few rounds', async () => {
    const { kit, log } = tools([ASSET_LIMITS.fileBytes, 60 * MB, 30 * MB]);
    expect((await shrinkImage(new ArrayBuffer(1), 'image/jpeg', kit, header)).byteLength).toBe(30 * MB);
    expect(log.decoded).toEqual([[8192, 5461], [4096, 2731], [2048, 1366]]);
    expect(log.closed).toBe(3);
    const stuck = tools([ASSET_LIMITS.fileBytes]);
    await expect(shrinkImage(new ArrayBuffer(1), 'image/png', stuck.kit, header)).rejects.toThrow('small enough');
    expect(stuck.log.closed).toBe(4);
  });

  it('fails, for the map to go unsent as it always did, when the size cannot be read or the copy cannot be saved', async () => {
    await expect(shrinkImage(new ArrayBuffer(1), 'image/png', tools([1]).kit, async () => null)).rejects.toThrow('size');
    await expect(shrinkImage(new ArrayBuffer(1), 'image/png', tools([0]).kit, header)).rejects.toThrow('small enough');
  });
});

describe('maps over the file limit in the asset registry', () => {
  const big = { stat: () => ({ size: ASSET_LIMITS.fileBytes * 3, mtime: 1 }) };

  it('sends a raster map over the limit as the smaller copy the files give, with one notice', async () => {
    const copy = new TextEncoder().encode('smaller copy of the map');
    const read = vi.fn(async (): Promise<ArrayBuffer> => copy.slice().buffer as ArrayBuffer);
    const files: ImageFiles = { ...big, read, reducesLarge: true };
    const notices: string[] = [];
    const assets = new AssetRegistry({ files, notify: (message) => notices.push(message), hash: nodeHash });
    assets.idFor('maps/huge.png');
    assets.idFor('maps/other-huge.jpg');
    await settle();
    expect(assets.idFor('maps/huge.png')).toBe(fingerprintOf('smaller copy of the map'));
    expect(notices).toEqual([IMAGE_REDUCED_NOTICE]);
    expect((await assets.read(fingerprintOf('smaller copy of the map')))?.mime).toBe('image/png');
  });

  it('still refuses what cannot be cut down: a vector, a model, or files that give no copy', async () => {
    const reducing: ImageFiles = { ...big, read: async () => new ArrayBuffer(8), reducesLarge: true };
    const notices: string[] = [];
    const assets = new AssetRegistry({ files: reducing, notify: (message) => notices.push(message), hash: nodeHash });
    expect(assets.idFor('maps/huge.svg')).toBeNull();
    expect(assets.idFor('minis/huge.glb')).toBeNull();
    expect(notices).toEqual([IMAGE_TOO_LARGE_NOTICE]);
    const plain: ImageFiles = { ...big, read: async () => new ArrayBuffer(8) };
    const second: string[] = [];
    new AssetRegistry({ files: plain, notify: (message) => second.push(message), hash: nodeHash }).idFor('maps/huge.png');
    expect(second).toEqual([IMAGE_TOO_LARGE_NOTICE]);
  });

  it('refuses a copy that is itself over the limit, and gives no reduced notice for an image under it', async () => {
    const stillBig: ImageFiles = { ...big, read: async () => new ArrayBuffer(ASSET_LIMITS.fileBytes + 1), reducesLarge: true };
    const notices: string[] = [];
    const assets = new AssetRegistry({ files: stillBig, notify: (message) => notices.push(message), hash: nodeHash });
    assets.idFor('maps/huge.png');
    await settle();
    expect(assets.idFor('maps/huge.png')).toBeNull();
    expect(notices).toEqual([IMAGE_TOO_LARGE_NOTICE]);
    const small: ImageFiles = { stat: () => ({ size: 10, mtime: 1 }), read: async () => new TextEncoder().encode('0123456789').buffer as ArrayBuffer, reducesLarge: true };
    const quiet: string[] = [];
    const ordinary = new AssetRegistry({ files: small, notify: (message) => quiet.push(message), hash: nodeHash });
    ordinary.idFor('a.png');
    await settle();
    expect(ordinary.idFor('a.png')).not.toBeNull();
    expect(quiet).toEqual([]);
  });

  it('knows a pixel image from a vector or a model', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'] as const) expect(isRasterMime(mime)).toBe(true);
    expect(isRasterMime('image/svg+xml')).toBe(false);
    expect(isRasterMime('model/gltf-binary')).toBe(false);
  });
});

describe("the vault's maps over the file limit", () => {
  function setup(size: number, name = 'maps/huge.png') {
    const file = new (TFile as unknown as new (path: string) => TFile)(name);
    file.stat = { ctime: 0, mtime: 5, size };
    const readBinary = vi.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer);
    const app = { vault: { getAbstractFileByPath: (path: string) => (path === name ? file : null), readBinary } } as unknown as App;
    const shrink = vi.fn(async (): Promise<ArrayBuffer> => new TextEncoder().encode('reduced').buffer as ArrayBuffer);
    return { file, readBinary, shrink, files: vaultImageFiles(app, shrink) };
  }

  it('says it cuts large images down, and hands out the copy instead of the image', async () => {
    const { files, shrink, readBinary } = setup(ASSET_LIMITS.fileBytes + 1);
    expect(files.reducesLarge).toBe(true);
    expect(new TextDecoder().decode(await files.read('maps/huge.png'))).toBe('reduced');
    expect(shrink).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'image/png');
    expect(readBinary).toHaveBeenCalledTimes(1);
  });

  it('makes the copy once as of the file\'s last change, giving each request a copy of its own', async () => {
    const { files, shrink, readBinary, file } = setup(ASSET_LIMITS.fileBytes + 1);
    const first = await files.read('maps/huge.png');
    const second = await files.read('maps/huge.png');
    expect(second).not.toBe(first);
    expect(shrink).toHaveBeenCalledTimes(1);
    expect(readBinary).toHaveBeenCalledTimes(1);
    file.stat = { ctime: 0, mtime: 6, size: ASSET_LIMITS.fileBytes + 1 };
    await files.read('maps/huge.png');
    expect(shrink).toHaveBeenCalledTimes(2);
  });

  it('asks again after an image that could not be cut down', async () => {
    const { files, shrink } = setup(ASSET_LIMITS.fileBytes + 1);
    shrink.mockRejectedValueOnce(new Error('out of memory'));
    await expect(files.read('maps/huge.png')).rejects.toThrow('out of memory');
    await Promise.resolve();
    expect(new TextDecoder().decode(await files.read('maps/huge.png'))).toBe('reduced');
    expect(shrink).toHaveBeenCalledTimes(2);
  });

  it('reads an image under the limit, and a vector over it, as they are', async () => {
    const small = setup(10);
    expect([...new Uint8Array(await small.files.read('maps/huge.png'))]).toEqual([1, 2, 3, 4]);
    expect(small.shrink).not.toHaveBeenCalled();
    const vector = setup(ASSET_LIMITS.fileBytes + 1, 'maps/huge.svg');
    expect([...new Uint8Array(await vector.files.read('maps/huge.svg'))]).toEqual([1, 2, 3, 4]);
    expect(vector.shrink).not.toHaveBeenCalled();
  });
});
