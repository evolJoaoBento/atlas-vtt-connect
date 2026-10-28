import { afterEach, describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { ASSET_LIMITS, isVideoPath } from '../../../src/app/online/assets/assetIds';
import { vaultImageFiles } from '../../../src/app/online/assets/vaultImageFiles';
import { videoStill } from '../../../src/app/online/assets/videoStill';
import { AssetRegistry, IMAGE_TOO_LARGE_NOTICE, type ImageFiles } from '../../../src/app/online/scene/AssetRegistry';
import { fingerprintOf, nodeHash, settle } from './assetFixtures';

/** What `videoStill` uses of a document, as a browser would answer it: a video that loads (or not) and a canvas that saves a PNG. */
function fakeDocument(behaviour: { load?: 'loaded' | 'error' | 'never'; width?: number; height?: number; png?: Uint8Array | null } = {}) {
  const log = { drawn: [] as number[][], released: 0, sources: [] as string[] };
  const png = behaviour.png === undefined ? new Uint8Array([137, 80, 78, 71]) : behaviour.png;
  const video = {
    muted: false, preload: '', playsInline: false, videoWidth: behaviour.width ?? 640, videoHeight: behaviour.height ?? 480,
    listeners: new Map<string, () => void>(),
    addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener); },
    set src(value: string) {
      log.sources.push(value);
      const how = behaviour.load ?? 'loaded';
      if (how === 'loaded') queueMicrotask(() => this.listeners.get('loadeddata')?.());
      if (how === 'error') queueMicrotask(() => this.listeners.get('error')?.());
    },
    removeAttribute() { /* the source goes */ },
    load() { log.released += 1; },
  };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (_source: unknown, ...args: number[]) => log.drawn.push(args) }),
    // A blob as Chromium gives it: jsdom's has no `arrayBuffer`.
    toBlob: (callback: (blob: Blob | null) => void) => callback(png ? ({ size: png.byteLength, type: 'image/png', arrayBuffer: async () => png.slice().buffer } as unknown as Blob) : null),
  };
  const doc = { createElement: (tag: string) => (tag === 'video' ? video : canvas) } as never;
  return { doc, log, video, canvas };
}

describe('a still of an animated map', () => {
  it('is the first frame of the video as a PNG, and the video is let go', async () => {
    const { doc, log, canvas } = fakeDocument({ width: 800, height: 600 });
    const bytes = await videoStill(doc, 'app://vault/maps/cave.webm');
    expect([...new Uint8Array(bytes)]).toEqual([137, 80, 78, 71]);
    expect(log.sources).toEqual(['app://vault/maps/cave.webm']);
    expect(log.drawn).toEqual([[0, 0, 800, 600]]);
    expect([canvas.width, canvas.height]).toEqual([800, 600]);
    expect(log.released).toBe(1);
  });

  it('fails, with the video let go, for a video that cannot play, has no picture, never gives a frame, or cannot be saved', async () => {
    for (const [behaviour, message] of [
      [{ load: 'error' as const }, 'could not be played'],
      [{ width: 0, height: 0 }, 'no picture'],
      [{ png: null }, 'still'],
    ] as const) {
      const { doc, log } = fakeDocument(behaviour);
      await expect(videoStill(doc, 'x.webm')).rejects.toThrow(message);
      expect(log.released).toBe(1);
    }
    const { doc, log } = fakeDocument({ load: 'never' });
    await expect(videoStill(doc, 'x.webm', 5)).rejects.toThrow('no first frame');
    expect(log.released).toBe(1);
  });
});

describe('animated maps in the asset registry', () => {
  it('knows a video by its extension, and no other file', () => {
    for (const path of ['maps/cave.webm', 'maps/cave.MP4', 'a/b.m4v', 'c.ogv', 'd.mov']) expect(isVideoPath(path)).toBe(true);
    for (const path of ['maps/cave.png', 'maps/cave.webp', 'notes/webm.md', 'mp4', 'folder.mp4/file', 'a.avi', '']) expect(isVideoPath(path)).toBe(false);
  });

  it('gives an animated map the id of its still, however large the video, and serves the still as a PNG', async () => {
    const still = new TextEncoder().encode('png of the first frame');
    const read = vi.fn(async (): Promise<ArrayBuffer> => still.slice().buffer);
    // The video is far over the limit for an image: only its still is sent.
    const files: ImageFiles = { stat: () => ({ size: ASSET_LIMITS.fileBytes * 4, mtime: 1 }), read };
    const notices: string[] = [];
    const assets = new AssetRegistry({ files, notify: (message) => notices.push(message), hash: nodeHash });
    expect(assets.idFor('maps/cave.webm')).toBeNull();
    await settle();
    const id = assets.idFor('maps/cave.webm');
    expect(id).toBe(fingerprintOf('png of the first frame'));
    expect(notices).toEqual([]);
    const served = await assets.read(id!);
    expect(served?.mime).toBe('image/png');
    expect(new TextDecoder().decode(served?.bytes)).toBe('png of the first frame');
  });

  it('still refuses an image over the limit, and gives a video that cannot be read no id', async () => {
    const big: ImageFiles = { stat: () => ({ size: ASSET_LIMITS.fileBytes + 1, mtime: 1 }), read: async () => new ArrayBuffer(0) };
    const notices: string[] = [];
    new AssetRegistry({ files: big, notify: (message) => notices.push(message), hash: nodeHash }).idFor('huge.png');
    expect(notices).toEqual([IMAGE_TOO_LARGE_NOTICE]);
    const broken: ImageFiles = { stat: () => ({ size: 10, mtime: 1 }), read: async () => { throw new Error('no frame'); } };
    const assets = new AssetRegistry({ files: broken, notify: () => undefined, hash: nodeHash });
    assets.idFor('maps/cave.webm');
    await settle();
    expect(assets.idFor('maps/cave.webm')).toBeNull();
  });
});

describe("the vault's animated maps", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function setup() {
    const file = new (TFile as unknown as new (path: string) => TFile)('maps/cave.webm');
    file.stat = { ctime: 0, mtime: 5, size: 90_000_000 };
    const resource = vi.fn((target: TFile) => `app://vault/${target.path}`);
    const readBinary = vi.fn(async () => new ArrayBuffer(0));
    const app = { vault: { getAbstractFileByPath: (path: string) => (path === 'maps/cave.webm' ? file : null), getResourcePath: resource, readBinary } } as unknown as App;
    const { doc, log } = fakeDocument();
    vi.stubGlobal('activeDocument', doc);
    return { file, resource, readBinary, log, files: vaultImageFiles(app) };
  }

  it('reads the first frame from the video where it lies, never the video, and keeps it until the file changes', async () => {
    const { file, resource, readBinary, log, files } = setup();
    expect(files.stat('maps/cave.webm')).toEqual({ size: 90_000_000, mtime: 5 });
    const first = new Uint8Array(await files.read('maps/cave.webm'));
    const second = await files.read('maps/cave.webm');
    expect([...first]).toEqual([137, 80, 78, 71]);
    expect(second.byteLength).toBe(4);
    expect(readBinary).not.toHaveBeenCalled();
    expect(resource).toHaveBeenCalledTimes(1);
    expect(log.sources).toEqual(['app://vault/maps/cave.webm']);
    // Each read is a copy of its own: a transfer may take the bytes it is given.
    expect(second).not.toBe(first.buffer);
    file.stat = { ctime: 0, mtime: 6, size: 90_000_000 };
    await files.read('maps/cave.webm');
    expect(resource).toHaveBeenCalledTimes(2);
  });

  it('asks again after a video that gave no frame', async () => {
    const { resource, files } = setup();
    vi.stubGlobal('activeDocument', fakeDocument({ load: 'error' }).doc);
    await expect(files.read('maps/cave.webm')).rejects.toThrow('could not be played');
    await Promise.resolve();
    vi.stubGlobal('activeDocument', fakeDocument().doc);
    expect((await files.read('maps/cave.webm')).byteLength).toBe(4);
    expect(resource).toHaveBeenCalledTimes(2);
  });
});
