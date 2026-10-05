import { describe, expect, it, vi } from 'vitest';
import type { SavedMapInput } from '@atlas-vtt/api-types';
import { createInMemoryApp } from '../mocks/inMemoryVault';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

const MAP = 'atlas-vtt/collections/source/scenes/Cave.atlasmap';

function emptyMap(overrides: Partial<SavedMapInput> = {}): SavedMapInput {
  return {
    background: null, grid: null, objects: { tokens: {}, texts: {}, drawings: {}, fog: {} },
    widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
    initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } }, ...overrides,
  };
}

function connected(id = 'atlas-vtt-connect') {
  const atlas = new FakeAtlas({ capabilities: ['scenes', 'bundles'] });
  const sceneId = atlas.scenes.addScene({ name: 'Cave', collectionId: 'source', mapPath: MAP });
  const plugin = connectingPlugin(id);
  return { atlas, sceneId, plugin, extension: atlas.connect(plugin) };
}

describe('FakeAtlas follows the scenes and bundles cases', () => {
  it('C-scenes-1: setData keeps data under the extension id, re-reads before writing, null clears it, and copies and exports drop it', async () => {
    const { atlas, extension, sceneId } = connected();
    await extension.scenes.setData(sceneId, { item: 'abc' });
    expect(atlas.scenes.record(sceneId)!.data).toEqual({ extensions: { 'atlas-vtt-connect': { item: 'abc' } } });
    atlas.scenes.moveMap(sceneId, 'moved.atlasmap');
    await extension.scenes.setData(sceneId, { item: 'def' });
    expect(atlas.scenes.record(sceneId)).toMatchObject({ mapPath: 'moved.atlasmap', data: { extensions: { 'atlas-vtt-connect': { item: 'def' } } } });
    expect(await extension.scenes.getData(sceneId)).toEqual({ item: 'def' });
    expect(Object.isFrozen(await extension.scenes.getData(sceneId))).toBe(true);
    expect(atlas.scenes.exported(sceneId)!.data).toEqual({});
    await extension.scenes.setData(sceneId, null);
    expect(atlas.scenes.record(sceneId)!.data).not.toHaveProperty('extensions');
    expect(await extension.scenes.getData(sceneId)).toBeUndefined();
  });

  it("C-scenes-1: setData leaves other extensions' data alone, copies its value, refuses what is not a scene or not JSON; a legacy data.sharing never travels", async () => {
    const { atlas, extension, sceneId } = connected();
    await atlas.connect(connectingPlugin('other')).scenes.setData(sceneId, 'theirs');
    const value = { list: [1] };
    await extension.scenes.setData(sceneId, value);
    value.list.push(2);
    expect(await extension.scenes.getData(sceneId)).toEqual({ list: [1] });
    await extension.scenes.setData(sceneId, null);
    expect(atlas.scenes.record(sceneId)!.data).toEqual({ extensions: { other: 'theirs' } });
    await expect(extension.scenes.setData('missing', 1)).rejects.toThrow(/no scene/);
    await expect(extension.scenes.setData(sceneId, undefined as never)).rejects.toThrow(/plain JSON/);
    await expect(extension.scenes.setData(sceneId, 1n as never)).rejects.toThrow(/plain JSON/);
    const legacy = atlas.scenes.addScene({ name: 'Old', mapPath: 'old.atlasmap', data: { sharing: { item: 'x' }, tags: ['t'] } });
    expect(atlas.scenes.exported(legacy)!.data).toEqual({ tags: ['t'] });
  });

  // C-scenes-2 and C-scenes-3 follow Atlas's own cases (tests/api/scenes.test.ts at api-pr-13-end), over a vault.
  function inVault() {
    const vault = createInMemoryApp();
    const atlas = new FakeAtlas({ capabilities: ['scenes'], vault });
    atlas.scenes.addScene({ name: 'Cave', collectionId: 'source', mapPath: MAP });
    atlas.scenes.setMap(MAP, emptyMap({ background: 'atlas-vtt/assets/bg.png' }), {
      mapSize: { width: 320, height: 200 },
      saved: {
        diceLog: [{ id: 'roll' }], dmNotePath: 'DM/Secret.md', exploredMask: 'mask',
        objects: { pins: { p1: { id: 'p1', kind: 'pin', x: 5, y: 6, notePath: 'Notes/Cave entrance.md' } }, walls: { w: { id: 'w' } } },
        camera: { x: 12, y: 34, scale: 2 }, initiativeTrackerOpen: true, tokenSettings: { showNameplates: true, showHPBars: false, showStressBars: true, tokenRingSize: 1.5 },
      },
    });
    return { atlas, vault, scenes: atlas.connect(connectingPlugin('ext')).scenes };
  }

  it('C-scenes-2: addToCollection leaves nothing behind on failure and runs one at a time', async () => {
    const { atlas, vault, scenes } = inVault();
    const input = { collection: { name: 'Shared with me' }, name: 'Cave', folder: 'atlas-vtt/collections/Shared with me/Cave', map: emptyMap({ background: 'bg.webp' }), images: [{ path: 'bg.webp', data: new ArrayBuffer(4) }] };
    atlas.scenes.failNextAdd = { error: new Error('index full'), after: 'writes' };
    await expect(scenes.addToCollection(input)).rejects.toThrow('index full');
    expect(vault.files.has('atlas-vtt/collections/Shared with me/Cave/bg.webp')).toBe(false);
    expect(vault.files.has('atlas-vtt/collections/Shared with me/Cave/Cave.atlasmap')).toBe(false);
    expect(vault.folders.has('atlas-vtt/collections/Shared with me')).toBe(false);
    expect([...atlas.scenes.collections.keys()]).not.toContain('Shared with me');
    expect((await scenes.list()).map((scene) => scene.name)).toEqual(['Cave']);
    const [a, b] = await Promise.all([scenes.addToCollection(input), scenes.addToCollection({ ...input, name: 'Cave 2', folder: `${input.folder} 2` })]);
    expect(a.sceneId).not.toBe(b.sceneId);
    expect([...atlas.scenes.collections.keys()].filter((id) => id === 'Shared with me')).toHaveLength(1);
    expect(JSON.parse(vault.files.get(a.mapPath)!).state).toMatchObject({ mapPath: a.mapPath, background: `${input.folder}/bg.webp` });
    expect(await scenes.findByMap(a.mapPath)).toMatchObject({ id: a.sceneId, collectionId: 'Shared with me', mapPath: a.mapPath });
    // A name differing only by case finds the same collection.
    const again = await scenes.addToCollection({ ...input, collection: { name: 'shared WITH me' }, images: [] });
    expect(again.mapPath).toBe('atlas-vtt/collections/Shared with me/Cave/Cave (2).atlasmap');
    expect([...atlas.scenes.collections.keys()].filter((id) => id.toLowerCase() === 'shared with me')).toHaveLength(1);
  });

  it('C-scenes-2: addToCollection refuses paths that leave the folder, and writes nothing', async () => {
    const { vault, scenes } = inVault();
    const folder = 'atlas-vtt/collections/source/Cave';
    const base = { collection: { id: 'source' }, name: 'Cave', folder, map: emptyMap(), images: [] };
    for (const path of ['../escape.webp', '/abs.webp', 'a/../../b.webp', 'a\\b.webp', '', 'a//b.webp']) {
      await expect(scenes.addToCollection({ ...base, images: [{ path, data: new ArrayBuffer(1) }] })).rejects.toThrow();
    }
    await expect(scenes.addToCollection({ ...base, folder: 'atlas-vtt/collections/other/Cave' })).rejects.toThrow(/inside the collection/);
    await expect(scenes.addToCollection({ ...base, folder: 'atlas-vtt/collections/source/../x' })).rejects.toThrow();
    await expect(scenes.addToCollection({ ...base, collection: { id: 'nope' } })).rejects.toThrow(/no collection/);
    await expect(scenes.addToCollection({ ...base, collection: { name: 'bad/name' } })).rejects.toThrow(/cannot contain/);
    expect(vault.folders.has(folder)).toBe(false);
    expect([...vault.files.keys()].some((path) => path.includes('escape') || path.includes('abs.webp'))).toBe(false);
  });

  it('C-scenes-2: addToCollection into an existing collection keeps it, numbers a taken map name and does not touch existing files', async () => {
    const { atlas, vault, scenes } = inVault();
    const input = { collection: { id: 'source' }, name: 'Cave', folder: 'atlas-vtt/collections/source/scenes', map: emptyMap(), images: [] };
    const before = vault.files.get(MAP);
    const added = await scenes.addToCollection(input);
    expect(added.mapPath).toBe('atlas-vtt/collections/source/scenes/Cave (2).atlasmap');
    expect(vault.files.get(MAP)).toBe(before);
    await expect(scenes.addToCollection({ ...input, images: [{ path: '../scenes/Cave.atlasmap', data: new ArrayBuffer(1) }] })).rejects.toThrow();
    atlas.scenes.failNextAdd = { error: new Error('nope'), after: 'writes' };
    await expect(scenes.addToCollection(input)).rejects.toThrow('nope');
    expect(vault.files.get(MAP)).toBe(before);
    expect(vault.files.has(added.mapPath)).toBe(true);
    expect(vault.files.has('atlas-vtt/collections/source/scenes/Cave (3).atlasmap')).toBe(false);
    expect(vault.folders.has('atlas-vtt/collections/source')).toBe(true);
    // The map file is what Atlas's own save writes, under the name's folder-safe stem.
    expect(JSON.parse(vault.files.get(added.mapPath)!)).toMatchObject({ version: 4, state: { schema: 'atlas-vtt', version: 4, name: 'Cave', objects: { pins: {}, walls: {}, lights: {} }, camera: { x: 0, y: 0, scale: 1 } } });
    expect((await scenes.addToCollection({ ...input, name: 'A/B: c' })).mapPath).toBe('atlas-vtt/collections/source/scenes/A-B- c.atlasmap');
  });

  it('C-scenes-2: a failed addToCollection removes only the record it added, and never takes a path an index record names', async () => {
    const { atlas, vault, scenes } = inVault();
    const input = { collection: { id: 'source' }, name: 'Cave', folder: 'atlas-vtt/collections/source/scenes', map: emptyMap(), images: [] };
    const ghostPath = 'atlas-vtt/collections/source/scenes/Cave (2).atlasmap';
    const ghost = atlas.scenes.addScene({ name: 'Ghost', collectionId: 'source', mapPath: ghostPath });
    atlas.scenes.failNextAdd = { error: new Error('index not saved'), after: 'record' };
    await expect(scenes.addToCollection(input)).rejects.toThrow('index not saved');
    expect(atlas.scenes.record(ghost)).not.toBeNull();
    expect((await scenes.list()).map((scene) => scene.name).sort()).toEqual(['Cave', 'Ghost']);
    expect(vault.files.has(ghostPath)).toBe(false);
    expect(vault.files.has('atlas-vtt/collections/source/scenes/Cave (3).atlasmap')).toBe(false);
    atlas.scenes.failNextAdd = { error: new Error('again'), after: 'writes' };
    await expect(scenes.addToCollection(input)).rejects.toThrow('again');
    expect(atlas.scenes.record(ghost)).not.toBeNull();
  });

  it('C-scenes-3: readMap returns the migrated map with its size, or null for a missing file', async () => {
    const { scenes } = inVault();
    const map = await scenes.readMap(MAP);
    expect(map?.objects.tokens).toEqual({});
    expect(map?.background).toBe('atlas-vtt/assets/bg.png');
    expect(map?.mapSize).toEqual({ width: 320, height: 200 });
    expect(await scenes.readMap('nope.atlasmap')).toBeNull();
    await expect(scenes.readMap('atlas-vtt/assets/bg.png')).rejects.toThrow(/\.atlasmap/);
  });

  it('C-scenes-3: readMap copies nothing private, hands out a frozen copy and sizes a map without a background 0 x 0', async () => {
    const { atlas, scenes } = inVault();
    const map = (await scenes.readMap(MAP))!;
    expect(Object.keys(map).sort()).toEqual([
      'background', 'camera', 'grid', 'initiative', 'initiativeTrackerOpen', 'lightZones', 'lighting', 'lights', 'mapSize', 'objects',
      'pins', 'tokenSettings', 'walls', 'widgets',
    ]);
    expect(Object.keys(map.objects).sort()).toEqual(['drawings', 'fog', 'texts', 'tokens']);
    expect(JSON.stringify(map)).not.toContain('Secret');
    expect(JSON.stringify(map)).not.toContain('mask');
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.objects)).toBe(true);
    expect(Object.isFrozen(map.pins!.p1)).toBe(true);
    expect(Object.isFrozen(map.tokenSettings)).toBe(true);
    const plain = 'atlas-vtt/collections/source/scenes/Plain.atlasmap';
    atlas.scenes.setMap(plain, { background: null, grid: null, objects: { tokens: {}, texts: {}, drawings: {}, fog: {} } });
    const read = (await scenes.readMap(plain))!;
    expect(read.mapSize).toEqual({ width: 0, height: 0 });
    // An older file without widgets, initiative or lighting gets Atlas's defaults, lighting off.
    expect(read.widgets).toEqual({ settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} });
    expect(read.initiative).toEqual({ entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } });
    expect(read.lighting).toEqual({ enabled: false, ambient: 0.1 });
    atlas.scenes.setMap('lit.atlasmap', emptyMap({ lighting: { enabled: true, ambient: 0 } }));
    expect((await scenes.readMap('lit.atlasmap'))!.lighting).toEqual({ enabled: true, ambient: 0 });
  });

  it('C-scenes-4: scenes-changed fires when scene records are added, renamed, moved or removed, and not for anything else, until stopped', () => {
    const { atlas, extension, sceneId } = connected();
    const changed = vi.fn();
    const stop = extension.on('scenes-changed', changed);
    atlas.scenes.tag(sceneId, ['x']);
    expect(changed).not.toHaveBeenCalled();
    const added = atlas.scenes.addScene({ name: 'Inn', mapPath: 'inn.atlasmap' });
    atlas.scenes.moveMap(added, 'tavern.atlasmap');
    atlas.scenes.removeScene(added);
    expect(changed).toHaveBeenCalledTimes(3);
    stop();
    atlas.scenes.addScene({ name: 'Again', mapPath: 'again.atlasmap' });
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('C-scenes-4: a failing listener does not stop the others', () => {
    const { atlas, extension } = connected();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const later = vi.fn();
    extension.on('scenes-changed', () => { throw new Error('boom'); });
    extension.on('scenes-changed', later);
    atlas.scenes.addScene({ name: 'Inn', mapPath: 'inn.atlasmap' });
    expect(later).toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('C-bundles-1: stripNoteProperties adds keys until disposed', () => {
    const { atlas, extension } = connected();
    const stop = extension.bundles.stripNoteProperties(['atlas-share']);
    expect(atlas.bundles.stripped().has('atlas-share')).toBe(true);
    expect(atlas.bundles.exportNote({ 'atlas-share': 'public', tags: ['a'] })).toEqual({ tags: ['a'] });
    stop();
    expect(atlas.bundles.stripped().has('atlas-share')).toBe(false);
    expect([...atlas.bundles.remembered]).toEqual([]);
  });

  it('C-bundles-2: a key stays stripped after the extension unloads, also after Atlas restarts, and bad input is refused', () => {
    const { atlas, extension, plugin } = connected();
    extension.bundles.stripNoteProperties(['Atlas-Share', 'secret']);
    expect([...atlas.bundles.stripped()].sort()).toEqual(['atlas-share', 'secret']);
    expect(() => extension.bundles.stripNoteProperties([''])).toThrow(/non-empty/);
    expect(() => extension.bundles.stripNoteProperties('atlas-share' as never)).toThrow(/array/);
    plugin.unload(); // the extension unloads
    expect([...atlas.bundles.stripped()].sort()).toEqual(['atlas-share', 'secret']);
    expect([...atlas.bundles.remembered.get('atlas-vtt-connect')!].sort()).toEqual(['atlas-share', 'secret']);
    atlas.bundles.restart(); // Atlas starts again with the extension not loaded: the settings bring the keys back
    expect([...atlas.bundles.stripped()].sort()).toEqual(['atlas-share', 'secret']);
  });

  it('C-bundles-3: an explicit dispose forgets the key, unless another registration of the extension still holds it; other extensions keep theirs', () => {
    const { atlas, extension } = connected();
    const first = extension.bundles.stripNoteProperties(['a', 'b']);
    const second = extension.bundles.stripNoteProperties(['b']);
    first();
    expect([...atlas.bundles.stripped()]).toEqual(['b']);
    second();
    expect(atlas.bundles.stripped().size).toBe(0);
    atlas.connect(connectingPlugin('two')).bundles.stripNoteProperties(['x']);
    extension.bundles.stripNoteProperties(['x'])();
    expect(atlas.bundles.stripped().has('x')).toBe(true);
    expect([...atlas.bundles.remembered.keys()]).toEqual(['two']);
  });

  it('C-bundles-4: forgetNoteProperties forgets what an extension asked for, also from earlier sessions, and nothing of another extension', () => {
    const { atlas, extension, plugin } = connected();
    atlas.connect(connectingPlugin('other')).bundles.stripNoteProperties(['x']);
    extension.bundles.stripNoteProperties(['old-key']);
    plugin.unload();
    atlas.bundles.restart();
    atlas.connect(connectingPlugin('other')).bundles.stripNoteProperties(['x']);
    expect(atlas.bundles.stripped().has('old-key')).toBe(true);
    atlas.connect(connectingPlugin('atlas-vtt-connect')).bundles.forgetNoteProperties();
    expect([...atlas.bundles.stripped()]).toEqual(['x']);
  });
});

describe('FakeAtlas follows what Atlas does around those cases', () => {
  it('moves a legacy data.sharing into Connect\'s extension data as the index loads, and it never travels', async () => {
    const atlas = new FakeAtlas({ capabilities: ['scenes'] });
    const id = atlas.scenes.addScene({ name: 'Old', mapPath: 'old.atlasmap', data: { sharing: { item: 'x' }, tags: ['t'] } });
    expect(await atlas.connect(connectingPlugin('atlas-vtt-connect')).scenes.getData(id)).toEqual({ item: 'x' });
    expect(atlas.scenes.record(id)!.data).toEqual({ tags: ['t'], extensions: { 'atlas-vtt-connect': { item: 'x' } } });
    expect(atlas.scenes.exported(id)!.data).toEqual({ tags: ['t'] });
  });

  it('strips the registered note properties from installs as from exports', () => {
    const atlas = new FakeAtlas({ capabilities: ['bundles'] });
    atlas.connect(connectingPlugin('atlas-vtt-connect')).bundles.stripNoteProperties(['atlas-share']);
    expect(atlas.bundles.installNote({ 'Atlas-Share': ['Ana'], tags: ['x'] })).toEqual({ tags: ['x'] });
  });

  it('gives a quarter circle for a stored cone angle no cone can open with, as mapConeAngle does', () => {
    const atlas = new FakeAtlas({ capabilities: ['rules'] });
    atlas.rules.saveCollection('c', { maps: ['m.atlasmap'], gridDefaults: { unitType: 'feet', unitDistance: 5, measurementMode: 'metric', coneAngle: 500 } });
    expect(atlas.connect(connectingPlugin('atlas-vtt-connect')).rules.forMap('m.atlasmap').measurement.coneAngle).toBe(90);
  });
});
