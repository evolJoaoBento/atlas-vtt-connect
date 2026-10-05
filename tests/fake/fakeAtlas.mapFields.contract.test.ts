import { describe, expect, it } from 'vitest';
import type { SavedMapInput } from '@atlas-vtt/api-types';
import { createInMemoryApp } from '../mocks/inMemoryVault';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

// API 1.13.0's saved map fields and scenes.replaceMap, as Atlas's own cases (tests/api/scenes.test.ts,
// scenesFields.test.ts and scenesReplace.test.ts at api-pr-13-end).

const FOLDER = 'atlas-vtt/collections/Shared with me/Cave';
const DEFAULT_TOKEN_SETTINGS = { showNameplates: false, hiddenResources: [], showInstanceBadges: true, tokenRingSize: 1 };

function emptyMap(overrides: Partial<SavedMapInput> = {}): SavedMapInput {
  return {
    background: null, grid: null, objects: { tokens: {}, texts: {}, drawings: {}, fog: {} },
    widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
    initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } }, ...overrides,
  };
}

const image = (path: string, text = path): { path: string; data: ArrayBuffer } => ({ path, data: new TextEncoder().encode(text).buffer as ArrayBuffer });
const withToken = (imagePath: string, fields: Partial<SavedMapInput> = {}): SavedMapInput => emptyMap({
  ...fields, objects: { tokens: { t1: { kind: 'token', id: 't1', x: 0, y: 0, imagePath } as never }, texts: {}, drawings: {}, fog: {} },
});

function inVault(id = 'ext') {
  const vault = createInMemoryApp();
  const atlas = new FakeAtlas({ capabilities: ['scenes', 'views'], vault });
  const gm = atlas.scenes.addScene({ name: 'Inn', collectionId: 'source', mapPath: 'atlas-vtt/collections/source/scenes/Inn.atlasmap' });
  atlas.scenes.setMap('atlas-vtt/collections/source/scenes/Inn.atlasmap', emptyMap());
  return { atlas, vault, gm, scenes: atlas.connect(connectingPlugin(id)).scenes };
}

type Scenes = ReturnType<typeof inVault>['scenes'];

/** A scene the extension added: background bg.webp, one token drawn with tok.png. */
const added = (scenes: Scenes): Promise<{ sceneId: string; mapPath: string }> => scenes.addToCollection({
  collection: { name: 'Shared with me' }, name: 'Cave', folder: FOLDER,
  map: withToken('tok.png', { background: 'bg.webp' }), images: [image('bg.webp', 'old bg'), image('tok.png', 'old token')],
});

const filesIn = (vault: ReturnType<typeof createInMemoryApp>): string[] => [...vault.files.keys()].filter((path) => path.startsWith(FOLDER)).sort();

describe('FakeAtlas follows the saved map fields of 1.13.0', () => {
  it('C-scenes-3: readMap hands out pins with their note links, walls, lights, camera, token settings and the tracker as saved', async () => {
    const { atlas, scenes } = inVault();
    atlas.scenes.setMap('m.atlasmap', emptyMap(), { saved: {
      objects: { pins: { p1: { id: 'p1', kind: 'pin', x: 5, y: 6, notePath: 'Notes/Cave entrance.md' } }, walls: { w: { id: 'w' } } },
      camera: { x: 12, y: 34, scale: 2 }, initiativeTrackerOpen: true, tokenSettings: { showNameplates: true, showHPBars: false, showStressBars: true, tokenRingSize: 1.5 },
    } });
    const map = (await scenes.readMap('m.atlasmap'))!;
    expect(map.pins).toEqual({ p1: { id: 'p1', kind: 'pin', x: 5, y: 6, notePath: 'Notes/Cave entrance.md' } });
    expect(map.walls).toEqual({ w: { id: 'w' } });
    expect(map.lights).toEqual({});
    expect(map.camera).toEqual({ x: 12, y: 34, scale: 2 });
    expect(map.initiativeTrackerOpen).toBe(true);
    expect(map.tokenSettings).toEqual({ ...DEFAULT_TOKEN_SETTINGS, showNameplates: true, tokenRingSize: 1.5, hiddenResources: ['hp'] });
  });

  it('C-scenes-3: readMap gives an old file without them empty records, the default camera and settings, and a closed tracker', async () => {
    const { vault, scenes } = inVault();
    const state = { schema: 'atlas-vtt', version: 3, background: null, grid: null, objects: { tokens: {}, fog: {}, texts: {}, drawings: {} }, camera: { x: 1, y: 1, scale: 0 } };
    vault.files.set('old.atlasmap', JSON.stringify({ state, version: 3 }));
    const map = (await scenes.readMap('old.atlasmap'))!;
    expect([map.pins, map.walls, map.lights, map.lightZones]).toEqual([{}, {}, {}, {}]);
    expect(map.camera).toEqual({ x: 0, y: 0, scale: 1 });
    expect(map.tokenSettings).toEqual(DEFAULT_TOKEN_SETTINGS);
    expect(map.initiativeTrackerOpen).toBe(false);
    expect(Object.isFrozen(map.camera)).toBe(true);
  });

  it('C-scenes-2: addToCollection writes the readMap fields, a readMap result round-trips, and a pin note is never an image path', async () => {
    const { vault, scenes } = inVault();
    const pins = { p: { id: 'p', kind: 'pin' as const, x: 1, y: 2, notePath: 'bg.webp', gmOnly: true } };
    const fields = {
      pins, walls: { w: { id: 'w' } as never }, lights: { l: { id: 'l' } as never }, lightZones: { z: { id: 'z' } as never },
      camera: { x: 3, y: 4, scale: 2 }, tokenSettings: { showNameplates: true, hiddenResources: ['hp'] }, initiativeTrackerOpen: true,
    };
    const { mapPath } = await scenes.addToCollection({ collection: { name: 'Shared with me' }, name: 'Cave', folder: FOLDER, map: emptyMap({ background: 'bg.webp', ...fields }), images: [image('bg.webp')] });
    const read = (await scenes.readMap(mapPath))!;
    expect(read.background).toBe(`${FOLDER}/bg.webp`);
    expect(read).toMatchObject({ ...fields, tokenSettings: { ...DEFAULT_TOKEN_SETTINGS, showNameplates: true, hiddenResources: ['hp'] } });
    expect(JSON.parse(vault.files.get(mapPath)!).state.tokenSettings).toMatchObject({ showHPBars: false, showStressBars: true });
    const again = await scenes.addToCollection({ collection: { name: 'Shared with me' }, name: 'Copy', folder: FOLDER, map: read, images: [] });
    expect(await scenes.readMap(again.mapPath)).toEqual(read);
  });

  it('C-scenes-2: a malformed optional field throws before anything is written; the old input shape writes the same file as before', async () => {
    const { atlas, vault, scenes } = inVault();
    const before = new Map(vault.files);
    const pin = (notePath: unknown, extra = {}): Partial<SavedMapInput> => ({ pins: { p: { id: 'p', kind: 'pin', x: 0, y: 0, notePath, ...extra } as never } });
    for (const bad of [pin('/abs.md'), pin('../out.md'), pin('Notes/a.md', { gmOnly: 'yes' }), { camera: { x: 0, y: 0, scale: 0 } },
      { tokenSettings: { tokenRingSize: 'big' } as never }, { walls: [] as never }, { lightZones: 3 as never }]) {
      await expect(scenes.addToCollection({ collection: { name: 'Shared with me' }, name: 'Cave', folder: FOLDER, map: emptyMap(bad), images: [image('bg.webp')] })).rejects.toThrow(/\[Atlas API\]/);
      expect(new Map(vault.files)).toEqual(before);
      expect([...atlas.scenes.collections.keys()]).not.toContain('Shared with me');
    }
    const { mapPath } = await scenes.addToCollection({ collection: { name: 'Shared with me' }, name: 'Cave', folder: FOLDER, map: emptyMap(), images: [] });
    const state = JSON.parse(vault.files.get(mapPath)!).state;
    expect(state).not.toHaveProperty('tokenSettings');
    expect(state.objects).toEqual({ tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {} });
  });
});

describe('FakeAtlas follows replaceMap (1.13.0)', () => {
  it('C-scenes-5: replaces the map and images of a scene the extension added, keeping its id, name and collection', async () => {
    const { atlas, vault, scenes } = inVault();
    const { sceneId, mapPath } = await added(scenes);
    const pins = { p: { id: 'p', kind: 'pin' as const, x: 1, y: 2, notePath: 'Notes/Cave.md' } };
    expect(await scenes.replaceMap!(sceneId, { map: emptyMap({ background: 'bg.webp', pins, camera: { x: 3, y: 4, scale: 2 } }), images: [image('bg.webp', 'new bg')] })).toEqual({ sceneId, mapPath });
    const map = (await scenes.readMap(mapPath))!;
    expect(map.background).toBe(`${FOLDER}/bg (2).webp`);
    expect(map.pins).toEqual(pins);
    expect(map.camera).toEqual({ x: 3, y: 4, scale: 2 });
    expect(filesIn(vault)).toEqual([`${FOLDER}/Cave.atlasmap`, `${FOLDER}/bg (2).webp`]);
    expect(vault.files.get(`${FOLDER}/bg (2).webp`)).toBe('new bg');
    expect(atlas.scenes.record(sceneId)).toMatchObject({ name: 'Cave', collectionId: 'Shared with me', mapPath });
  });

  it('C-scenes-5: keeps who added a scene in the index only, never in its record file or its extension data', async () => {
    const { atlas, scenes } = inVault();
    const { sceneId } = await added(scenes);
    expect(atlas.scenes.record(sceneId)!.data).toMatchObject({ createdBy: 'ext' });
    expect(JSON.stringify(atlas.scenes.exported(sceneId))).not.toContain('createdBy');
    expect(await scenes.getData(sceneId)).toBeUndefined();
  });

  it("C-scenes-5: refuses the GM's own scene, another extension's and an unknown id, changing nothing", async () => {
    const { atlas, vault, gm, scenes } = inVault();
    const { sceneId } = await added(scenes);
    const before = new Map(vault.files);
    const input = { map: emptyMap(), images: [image('new.webp')] };
    await expect(scenes.replaceMap!(gm, input)).rejects.toThrow(/only a scene this extension added/);
    await expect(atlas.connect(connectingPlugin('other')).scenes.replaceMap!(sceneId, input)).rejects.toThrow(/only a scene this extension added/);
    await expect(scenes.replaceMap!('nope', input)).rejects.toThrow(/no scene/);
    expect(new Map(vault.files)).toEqual(before);
  });

  it('C-scenes-5: malformed input leaves the map and its folder as they were', async () => {
    const { vault, scenes } = inVault();
    const { sceneId } = await added(scenes);
    const before = new Map(vault.files);
    for (const input of [
      { map: emptyMap({ camera: { x: 0, y: 0, scale: -1 } }), images: [image('new.webp')] },
      { map: emptyMap({ pins: { p: { id: 'p', kind: 'pin', x: 0, y: 0, notePath: '/abs.md' } } }), images: [] },
      { map: emptyMap(), images: [image('../out.webp')] },
      { map: null, images: [] },
    ]) {
      await expect(scenes.replaceMap!(sceneId, input as never)).rejects.toThrow(/\[Atlas API\]/);
      expect(new Map(vault.files)).toEqual(before);
    }
  });

  it('C-scenes-5: refuses a scene open in a map view, also as a tab not shown, and accepts it once the view closed', async () => {
    const { atlas, vault, scenes } = inVault();
    const { sceneId, mapPath } = await added(scenes);
    atlas.views.open('v1', [{ tabId: 't1', mapPath: 'other.atlasmap', name: 'Other' }, { tabId: 't2', mapPath, name: 'Cave' }]);
    const before = vault.files.get(mapPath);
    await expect(scenes.replaceMap!(sceneId, { map: emptyMap(), images: [] })).rejects.toThrow(/open in a map view/);
    expect(vault.files.get(mapPath)).toBe(before);
    atlas.views.close('v1');
    await expect(scenes.replaceMap!(sceneId, { map: emptyMap(), images: [] })).resolves.toEqual({ sceneId, mapPath });
  });

  it('C-scenes-5: checks again just before writing, so a tab opened meanwhile refuses the replace', async () => {
    const { atlas, vault, scenes } = inVault();
    const { sceneId, mapPath } = await added(scenes);
    const before = new Map(vault.files);
    atlas.scenes.beforeMapWrite = () => atlas.views.open('v1', [{ tabId: 't1', mapPath, name: 'Cave' }]);
    await expect(scenes.replaceMap!(sceneId, { map: emptyMap(), images: [image('new.webp')] })).rejects.toThrow(/open in a map view/);
    expect(new Map(vault.files)).toEqual(before);
  });

  it('C-scenes-5: removes only images Atlas wrote for the scene that nothing uses, and keeps the list to the live ones', async () => {
    const { atlas, vault, scenes } = inVault();
    const { sceneId, mapPath } = await added(scenes);
    vault.files.set(`${FOLDER}/gm-art.png`, 'gm art');
    const file = JSON.parse(vault.files.get(mapPath)!) as { state: { objects: { tokens: Record<string, { imagePath: string }> } } };
    file.state.objects.tokens.t1!.imagePath = `${FOLDER}/gm-art.png`;
    vault.files.set(mapPath, JSON.stringify(file));
    await scenes.replaceMap!(sceneId, { map: emptyMap({ background: 'one.webp' }), images: [image('one.webp')] });
    expect(filesIn(vault)).toEqual([`${FOLDER}/Cave.atlasmap`, `${FOLDER}/gm-art.png`, `${FOLDER}/one.webp`]);
    expect(atlas.scenes.record(sceneId)!.data.createdImages).toEqual([`${FOLDER}/one.webp`]);
    await scenes.replaceMap!(sceneId, { map: withToken(`${FOLDER}/one.webp`, { background: 'two.png' }), images: [image('two.png')] });
    expect(filesIn(vault)).toEqual([`${FOLDER}/Cave.atlasmap`, `${FOLDER}/gm-art.png`, `${FOLDER}/one.webp`, `${FOLDER}/two.png`]);
    expect((atlas.scenes.record(sceneId)!.data.createdImages as string[]).sort()).toEqual([`${FOLDER}/one.webp`, `${FOLDER}/two.png`]);
  });

  it("C-scenes-5: keeps the GM's note link, dice log, pinned previews and loot roller, and resets explored memory", async () => {
    const { vault, scenes } = inVault();
    const { sceneId, mapPath } = await added(scenes);
    const play = { dmNotePath: 'DM/Cave.md', diceLog: [{ id: 'r1' }], pinnedNotePreviews: [{ path: 'Notes/a.md' }], lootRoller: { open: true } };
    const file = JSON.parse(vault.files.get(mapPath)!) as { state: Record<string, unknown> };
    Object.assign(file.state, play, { exploredMask: 'mask' });
    vault.files.set(mapPath, JSON.stringify(file));
    await scenes.replaceMap!(sceneId, { map: emptyMap(), images: [] });
    const state = (JSON.parse(vault.files.get(mapPath)!) as { state: Record<string, unknown> }).state;
    expect(state).toMatchObject(play);
    expect(state).not.toHaveProperty('exploredMask');
  });
});
