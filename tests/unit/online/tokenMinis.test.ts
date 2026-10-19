import { describe, expect, it, vi } from 'vitest';
import type { Character, SceneSnapshot } from '@atlas-vtt/api-types';
import type { StoredImage } from '../../../src/app/online/assets/AssetCache';
import { ASSET_LIMITS, mimeForPath, sceneAssetIds } from '../../../src/app/online/assets/assetIds';
import { AssetLoader } from '../../../src/app/online/assets/AssetLoader';
import { encodeAsset, encodeChunk } from '../../../src/app/online/assets/assetProtocol';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import type { ProjectionContext } from '../../../src/app/online/scene/projectForPlayers';
import { isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { fingerprintOf, imageBytes, memoryImageFiles, nodeHash, settle } from './assetFixtures';
import { fakeAssetIds, playerScene, playerToken, projectForPlayers, snapshotOf } from './sceneFixtures';

const RULES = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };

function hero(overrides: Partial<Character> = {}): Character {
  return { id: 'hero', kind: 'character', x: 140, y: 140, imagePath: 'atlas-vtt/assets/hero.png', name: 'Anna', ...overrides };
}
function withTokens(tokens: Record<string, Character>): SceneSnapshot {
  const state = snapshotOf({ background: 'atlas-vtt/assets/lair.png', grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5, lineType: 'solid', lineWidth: 1 } });
  return { ...state, objects: { ...state.objects, tokens } };
}
function context(overrides: Partial<ProjectionContext> = {}): ProjectionContext {
  return { sceneId: 'scene-1', rules: RULES, coverage: FogCoverage.EMPTY, assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 }, ...overrides };
}

describe('minis on tokens', () => {
  it('sends a token its mini by fingerprint, never by path', () => {
    const scene = projectForPlayers(withTokens({ hero: hero() }), context({ minis: { hero: { mini: 'atlas-vtt/assets/minis/orc.glb', scale: 1.5, turn: 90 } } }));
    expect(scene.tokens.hero?.mini).toEqual({ asset: expect.any(String), scale: 1.5, turn: 90 });
    expect(JSON.stringify(scene)).not.toContain('orc');
  });

  it('sends no mini without the Tabletop source, nor for a token without one', () => {
    expect(projectForPlayers(withTokens({ hero: hero() }), context()).tokens.hero).not.toHaveProperty('mini');
    const scene = projectForPlayers(withTokens({ hero: hero(), other: hero({ id: 'other' }) }), context({ minis: { other: { mini: 'm.glb', scale: 1, turn: 0 } } }));
    expect(scene.tokens.hero).not.toHaveProperty('mini');
    expect(scene.tokens.other).toHaveProperty('mini');
  });

  it('never sends the mini of a hidden token', () => {
    const scene = projectForPlayers(withTokens({ ghost: hero({ id: 'ghost', isHidden: true }) }), context({ minis: { ghost: { mini: 'm.glb', scale: 1, turn: 0 } } }));
    expect(scene.tokens).toEqual({});
    expect(JSON.stringify(scene)).not.toContain('mini');
  });

  it('clamps the size and turn players get', () => {
    const scene = projectForPlayers(withTokens({ hero: hero() }), context({ minis: { hero: { mini: 'm.glb', scale: 99, turn: -90 } } }));
    expect(scene.tokens.hero?.mini).toMatchObject({ scale: 4, turn: 270 });
  });

  it('validates a scene with minis, and refuses a broken one', () => {
    const asset = 'A'.repeat(43);
    expect(isPlayerSceneBody(playerScene({ tokens: { t: playerToken({ mini: { asset, scale: 1, turn: 0 } }) } }))).toBe(true);
    expect(isPlayerSceneBody(playerScene({ tokens: { t: playerToken({ mini: { asset: null, scale: 1, turn: 0 } }) } }))).toBe(true);
    expect(isPlayerSceneBody(playerScene({ tokens: { t: playerToken({ mini: { asset, scale: 50, turn: 0 } }) } }))).toBe(false);
  });

  it('counts a mini among the assets a scene shows, so the GM serves it to that scene only', () => {
    const map = 'M'.repeat(43);
    const art = 'T'.repeat(43);
    const mini = 'G'.repeat(43);
    const scene = playerScene({ map: { asset: map, width: 1000, height: 800, cellSize: 70 }, tokens: { t: playerToken({ image: art, mini: { asset: mini, scale: 1, turn: 0 } }) } });
    expect(sceneAssetIds(scene)).toEqual([map, art, mini]);
    expect(sceneAssetIds(scene, { minis: false })).toEqual([map, art]);
  });

  it('knows a .glb as a model, which the GM fingerprints and serves like an image', async () => {
    expect(mimeForPath('atlas-vtt/assets/minis/Orc.GLB')).toBe('model/gltf-binary');
    const files = memoryImageFiles({ 'atlas-vtt/assets/minis/orc.glb': 'glb bytes' });
    const assets = new AssetRegistry({ files: files.source, notify: () => undefined, hash: nodeHash });
    expect(assets.idFor('atlas-vtt/assets/minis/orc.glb')).toBeNull();
    await vi.waitFor(() => expect(assets.idFor('atlas-vtt/assets/minis/orc.glb')).toBe(fingerprintOf('glb bytes')));
    expect((await assets.read(fingerprintOf('glb bytes')))?.mime).toBe('model/gltf-binary');
  });

  it('keeps a mini\'s bytes once checked, without decoding them as an image', async () => {
    const glb = imageBytes(ASSET_LIMITS.chunkBytes + 10, 7);
    const id = fingerprintOf(glb);
    const put = vi.fn(async (_image: StoredImage): Promise<void> => undefined);
    const decode = vi.fn(async () => null);
    const loader = new AssetLoader({ cache: { get: async () => null, put }, decode, hash: nodeHash, onChange: () => undefined, models: () => true });
    loader.connected(() => undefined);
    loader.setScene(playerScene({ tokens: { t: playerToken({ image: null, mini: { asset: id, scale: 1, turn: 0 } }) } }));
    await settle();
    loader.receive(encodeAsset({ v: 1, type: 'asset-start', id, handle: 1, size: glb.byteLength, mime: 'model/gltf-binary' }));
    loader.receive(encodeChunk(1, glb.subarray(0, ASSET_LIMITS.chunkBytes)));
    loader.receive(encodeChunk(1, glb.subarray(ASSET_LIMITS.chunkBytes)));
    loader.receive(encodeAsset({ v: 1, type: 'asset-end', handle: 1 }));
    await settle();
    expect(decode).not.toHaveBeenCalled();
    expect(new Uint8Array(loader.model(id) ?? new ArrayBuffer(0))).toEqual(glb);
    expect(loader.image(id)).toBeNull();
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ id, mime: 'model/gltf-binary' }));
  });

  it('never asks for the model of a mini on a view that does not draw minis (the web page)', async () => {
    const id = fingerprintOf(imageBytes(64, 3));
    const sent: string[] = [];
    const loader = new AssetLoader({ cache: { get: async () => null, put: async () => undefined }, decode: async () => null, hash: nodeHash, onChange: () => undefined });
    loader.connected((data) => { sent.push(data); });
    loader.setScene(playerScene({ tokens: { t: playerToken({ image: null, mini: { asset: id, scale: 1, turn: 0 } }) } }));
    await settle();
    expect(sent.some((data) => data.includes(id))).toBe(false);
    expect(loader.model(id)).toBeNull();
  });
});
