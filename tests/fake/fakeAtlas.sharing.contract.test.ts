import { describe, expect, it, vi } from 'vitest';
import type { SavedMapInput } from '@atlas-vtt/api-types';
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

  it('C-scenes-2: addToCollection writes into the vault and adds the record, one at a time, and leaves nothing behind on failure', async () => {
    const { atlas, extension } = connected();
    const input = { collection: { name: 'Shared with me' }, name: 'Cave', folder: 'atlas-vtt/collections/Shared with me/Cave', map: emptyMap({ background: 'bg.webp' }), images: [{ path: 'bg.webp', data: new ArrayBuffer(4) }] };
    atlas.scenes.failNextAdd = new Error('index full');
    await expect(extension.scenes.addToCollection(input)).rejects.toThrow('index full');
    expect([...atlas.scenes.files.keys()]).toEqual([]);
    expect(atlas.scenes.collections.has('Shared with me')).toBe(false);
    expect((await extension.scenes.list()).map((scene) => scene.name)).toEqual(['Cave']);
    const [a, b] = await Promise.all([extension.scenes.addToCollection(input), extension.scenes.addToCollection({ ...input, name: 'Cave 2', folder: `${input.folder} 2` })]);
    expect(a.sceneId).not.toBe(b.sceneId);
    expect(a.mapPath).toBe('atlas-vtt/collections/Shared with me/Cave/Cave.atlasmap');
    expect(atlas.scenes.files.has('atlas-vtt/collections/Shared with me/Cave/bg.webp')).toBe(true);
    expect(await extension.scenes.findByMap(a.mapPath)).toMatchObject({ id: a.sceneId, collectionId: 'Shared with me' });
    // A taken map name is numbered, never replaced.
    const again = await extension.scenes.addToCollection({ ...input, images: [] });
    expect(again.mapPath).toBe('atlas-vtt/collections/Shared with me/Cave/Cave (2).atlasmap');
  });

  it('C-scenes-2: addToCollection refuses paths that leave the folder, and writes nothing', async () => {
    const { atlas, extension } = connected();
    const base = { collection: { id: 'source' }, name: 'Cave', folder: 'atlas-vtt/collections/source/Cave', map: emptyMap(), images: [] };
    for (const path of ['../escape.webp', '/abs.webp', 'a/../../b.webp', 'a\\b.webp', '', 'a//b.webp']) {
      await expect(extension.scenes.addToCollection({ ...base, images: [{ path, data: new ArrayBuffer(1) }] })).rejects.toThrow();
    }
    await expect(extension.scenes.addToCollection({ ...base, folder: 'atlas-vtt/collections/other/Cave' })).rejects.toThrow(/inside the collection/);
    await expect(extension.scenes.addToCollection({ ...base, folder: 'atlas-vtt/collections/source/../x' })).rejects.toThrow();
    await expect(extension.scenes.addToCollection({ ...base, collection: { id: 'nope' } })).rejects.toThrow(/no collection/);
    await expect(extension.scenes.addToCollection({ ...base, collection: { name: 'bad/name' } })).rejects.toThrow(/cannot contain/);
    expect(atlas.scenes.files.size).toBe(0);
  });

  it('C-scenes-3: readMap returns the saved map with its size, a frozen copy without anything private, or null for a missing file', async () => {
    const { atlas, extension } = connected();
    atlas.scenes.setMap(MAP, { ...emptyMap({ background: 'atlas-vtt/assets/bg.png' }), mapSize: { width: 320, height: 200 }, dmNotePath: 'DM/Secret.md', pins: { p: { notePath: 'DM/Secret.md' } } });
    const map = (await extension.scenes.readMap(MAP))!;
    expect(Object.keys(map).sort()).toEqual(['background', 'grid', 'initiative', 'mapSize', 'objects', 'widgets']);
    expect(Object.keys(map.objects).sort()).toEqual(['drawings', 'fog', 'texts', 'tokens']);
    expect(map.mapSize).toEqual({ width: 320, height: 200 });
    expect(JSON.stringify(map)).not.toContain('Secret');
    expect(Object.isFrozen(map)).toBe(true);
    expect(Object.isFrozen(map.objects)).toBe(true);
    expect(await extension.scenes.readMap('nope.atlasmap')).toBeNull();
    await expect(extension.scenes.readMap('atlas-vtt/assets/bg.png')).rejects.toThrow(/\.atlasmap/);
    atlas.scenes.setMap('lit.atlasmap', emptyMap({ lighting: { enabled: true, ambient: 0 } }));
    expect((await extension.scenes.readMap('lit.atlasmap'))!.lighting).toEqual({ enabled: true, ambient: 0 });
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
