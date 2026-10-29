import { describe, expect, it } from 'vitest';
import { ASSET_LIMITS, isAssetMime, isVideoMime, sceneAssetIds, videoMimeForPath } from '../../../src/app/online/assets/assetIds';
import { AssetRegistry, VIDEO_TOO_LARGE_NOTICE, type ImageFiles } from '../../../src/app/online/scene/AssetRegistry';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { createMapLayer } from '../../../src/app/online/view/layers/mapLayer';
import { fingerprintOf, nodeHash, settle } from './assetFixtures';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene, projectForPlayers, snapshotOf } from './sceneFixtures';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';

const STILL = 'png of the first frame';
const VIDEO = 'bytes of the whole video';
const VIDEO_ID = fingerprintOf(VIDEO);
const STILL_ID = fingerprintOf(STILL);

/** A vault with one animated map: `read` gives its still, `read(path, true)` the video itself. */
function files(size = VIDEO.length): ImageFiles {
  const text = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer as ArrayBuffer;
  return { stat: () => ({ size, mtime: 1 }), read: async (_path, raw) => text(raw ? VIDEO : STILL) };
}

describe('the video of an animated map, for a view that plays it', () => {
  it('knows MP4 and WebM as videos to send, and leaves the other formats a still', () => {
    expect(videoMimeForPath('maps/cave.webm')).toBe('video/webm');
    expect(videoMimeForPath('maps/cave.MP4')).toBe('video/mp4');
    expect(videoMimeForPath('a/b.m4v')).toBe('video/mp4');
    for (const path of ['c.ogv', 'd.mov', 'e.png', 'mp4', 'folder.mp4/file', '']) expect(videoMimeForPath(path)).toBeNull();
    expect(isAssetMime('video/mp4') && isVideoMime('video/webm') && !isVideoMime('image/png')).toBe(true);
  });

  it('gives the video an id of its own beside the still, and serves each as itself', async () => {
    const assets = new AssetRegistry({ files: files(), notify: () => undefined, hash: nodeHash });
    expect(assets.idFor('maps/cave.webm')).toBeNull();
    expect(assets.videoIdFor('maps/cave.webm')).toBeNull();
    await settle();
    expect(assets.idFor('maps/cave.webm')).toBe(STILL_ID);
    expect(assets.videoIdFor('maps/cave.webm')).toBe(VIDEO_ID);
    const still = await assets.read(STILL_ID);
    const video = await assets.read(VIDEO_ID);
    expect([still?.mime, new TextDecoder().decode(still?.bytes)]).toEqual(['image/png', STILL]);
    expect([video?.mime, new TextDecoder().decode(video?.bytes)]).toEqual(['video/webm', VIDEO]);
  });

  it('gives no video id to an image, a missing file or a format a browser may not play', async () => {
    const assets = new AssetRegistry({ files: files(), notify: () => undefined, hash: nodeHash });
    for (const path of ['maps/cave.png', 'maps/cave.mov', '', null, undefined]) expect(assets.videoIdFor(path)).toBeNull();
    expect(new AssetRegistry({ files: { stat: () => null, read: async () => new ArrayBuffer(0) }, notify: () => undefined, hash: nodeHash }).videoIdFor('x.webm')).toBeNull();
  });

  it('keeps the still, and tells the GM once, for a video over the file limit', async () => {
    const notices: string[] = [];
    const assets = new AssetRegistry({ files: files(ASSET_LIMITS.fileBytes + 1), notify: (message) => notices.push(message), hash: nodeHash });
    expect(assets.videoIdFor('maps/cave.webm')).toBeNull();
    expect(assets.videoIdFor('maps/cave.webm')).toBeNull();
    expect(notices).toEqual([VIDEO_TOO_LARGE_NOTICE]);
    assets.idFor('maps/cave.webm');
    await settle();
    expect(assets.idFor('maps/cave.webm')).toBe(STILL_ID);
  });

  it('forgets the video when its file changes, and hashes it again', async () => {
    let video = VIDEO;
    const source: ImageFiles = { stat: () => ({ size: video.length, mtime: video.length }), read: async (_p, raw) => new TextEncoder().encode(raw ? video : STILL).buffer as ArrayBuffer };
    const assets = new AssetRegistry({ files: source, notify: () => undefined, hash: nodeHash });
    assets.videoIdFor('m.webm');
    await settle();
    expect(assets.videoIdFor('m.webm')).toBe(VIDEO_ID);
    video = 'a different video';
    assets.videoIdFor('m.webm');
    await settle();
    expect(assets.videoIdFor('m.webm')).toBe(fingerprintOf('a different video'));
  });

  it('is asked for by a view that plays it and by none other', () => {
    const scene = playerScene({ map: { asset: STILL_ID, video: VIDEO_ID, width: 1000, height: 800, cellSize: 70 } });
    expect(sceneAssetIds(scene)).toContain(VIDEO_ID);
    expect(sceneAssetIds(scene, { video: false })).toEqual(expect.not.arrayContaining([VIDEO_ID]));
    expect(sceneAssetIds(scene, { video: false })).toContain(STILL_ID);
  });

  it('goes in the map on the wire, refused when it is not an asset id', () => {
    const scene = playerScene({ map: { asset: STILL_ID, video: VIDEO_ID, width: 1000, height: 800, cellSize: 70 } });
    expect(isPlayerSceneBody(scene)).toBe(true);
    expect(isPlayerSceneBody({ ...scene, map: { ...scene.map, video: '../x.mp4' } })).toBe(false);
  });
});

describe('the map layer with a video', () => {
  const clip = (paused: boolean) => {
    const log = { plays: 0 };
    const image = { videoWidth: 640, videoHeight: 480, paused, play: () => { log.plays += 1; return Promise.resolve(); } };
    return { decoded: { image: image as unknown as HTMLVideoElement, width: 640, height: 480, release: () => undefined }, log };
  };
  const scene = playerScene({ map: { asset: 'still', video: 'clip', width: 1000, height: 800, cellSize: 70 } });

  it('draws the video instead of the still once it is ready, and keeps the view drawing while it plays', () => {
    const layer = createMapLayer();
    const surface = new RecordingSurface();
    const { decoded } = clip(false);
    const still = { image: { width: 5, height: 5 } as unknown as ImageBitmap, width: 5, height: 5, release: () => undefined };
    layer.draw(surface, frame(scene, { images: (id) => (id === 'clip' ? decoded : id === 'still' ? still : null) }));
    expect(surface.calls).toEqual([{ op: 'image', image: decoded.image, x: 0, y: 0, width: 1000, height: 800, clip: null }]);
    expect(layer.animating?.()).toBe(true);
  });

  it('shows the still while the video loads, and then is not animating', () => {
    const layer = createMapLayer();
    const surface = new RecordingSurface();
    const still = { image: { width: 5, height: 5 } as unknown as ImageBitmap, width: 5, height: 5, release: () => undefined };
    layer.draw(surface, frame(scene, { images: (id) => (id === 'still' ? still : null) }));
    expect(surface.calls).toEqual([{ op: 'image', image: still.image, x: 0, y: 0, width: 1000, height: 800, clip: null }]);
    expect(layer.animating?.()).toBe(false);
  });

  it('starts a video the browser left paused', () => {
    const layer = createMapLayer();
    const { decoded, log } = clip(true);
    layer.draw(new RecordingSurface(), frame(scene, { images: (id) => (id === 'clip' ? decoded : null) }));
    expect(log.plays).toBe(1);
  });
});

describe('the projection of an animated map', () => {
  it('sends the video id beside the still, and none for a map that is not one', () => {
    const state = snapshotOf({ background: 'maps/cave.webm' });
    const rules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
    const assets = { idFor: () => STILL_ID, videoIdFor: (path: string | null | undefined) => (path === 'maps/cave.webm' ? VIDEO_ID : null) };
    const context = { sceneId: 's', rules, coverage: FogCoverage.EMPTY, assets, mapSize: { width: 1000, height: 800 }, resources: [] };
    const scene = projectForPlayers(state, context);
    expect([scene.map.asset, scene.map.video]).toEqual([STILL_ID, VIDEO_ID]);
    expect(isPlayerSceneBody(scene)).toBe(true);
    expect(projectForPlayers({ ...state, background: 'maps/cave.png' }, context).map).not.toHaveProperty('video');
    expect(projectForPlayers(state, { ...context, assets: { idFor: () => STILL_ID } }).map).not.toHaveProperty('video');
  });
});

describe('the order of a scene’s assets', () => {
  it('puts the video after everything else, so its size holds up nothing', () => {
    const scene = playerScene({ map: { asset: STILL_ID, video: VIDEO_ID, width: 1000, height: 800, cellSize: 70 } });
    const ids = sceneAssetIds(scene);
    expect(ids[0]).toBe(STILL_ID);
    expect(ids.at(-1)).toBe(VIDEO_ID);
  });
});
