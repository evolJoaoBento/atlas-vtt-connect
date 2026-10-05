import { describe, expect, it, vi } from 'vitest';
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import { DEFAULT_CONE_ANGLE } from '@atlas-vtt/shared/grid';
import { DEFAULT_DICE_RULES } from '@atlas-vtt/shared/rules';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

const MAP = 'maps/a.atlasmap';

/** A loaded scene of `MAP` with fresh records. */
function loaded(partial: Partial<SceneSnapshot> = {}): Omit<SceneSnapshot, 'viewId'> {
  return {
    mapPath: MAP, loaded: true, mapSize: { width: 1000, height: 500 }, background: null, grid: null,
    objects: { tokens: {}, texts: {}, drawings: {}, fog: {} },
    widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
    initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } },
    initiativeTrackerOpen: false, lighting: { enabled: false, ambient: 1 }, ...partial,
  };
}

function connected(): { atlas: FakeAtlas; extension: ReturnType<FakeAtlas['connect']> } {
  const atlas = new FakeAtlas({ capabilities: ['views', 'presentation', 'rules'] });
  return { atlas, extension: atlas.connect(connectingPlugin('atlas-vtt-connect')) };
}

describe('FakeAtlas follows the views, rules and presentation cases', () => {
  it('C-views-1: snapshot is null for an unknown or closed view', () => {
    const { atlas, extension } = connected();
    atlas.views.setSnapshot('v1', loaded());
    expect(extension.views.snapshot('nope')).toBeNull();
    atlas.views.close('v1');
    expect(extension.views.snapshot('v1')).toBeNull();
  });

  it('C-views-2: loaded is false while the map loads; subscribe fires on a replaced field, not on the camera', () => {
    const { atlas, extension } = connected();
    atlas.views.setSnapshot('v1', loaded({ loaded: false }));
    expect(extension.views.snapshot('v1')!.loaded).toBe(false);
    atlas.views.update('v1', { loaded: true });
    const listener = vi.fn();
    extension.views.subscribe('v1', listener);
    atlas.views.setCamera('v1', { centerX: 1, centerY: 1, width: 10, height: 10 });
    atlas.views.frame('v1');
    expect(listener).not.toHaveBeenCalled();
    const tokens = {};
    atlas.views.update('v1', { objects: { ...extension.views.snapshot('v1')!.objects, tokens } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].objects.tokens).toBe(tokens);
    expect(listener.mock.calls[0]![0].mapSize).toEqual({ width: 1000, height: 500 });
  });

  it('C-views-2: a snapshot passes the records by reference, in fresh frozen wrappers, with no pins, walls, lights or audio', () => {
    const { atlas, extension } = connected();
    const scene = loaded();
    atlas.views.setSnapshot('v1', scene);
    const first = extension.views.snapshot('v1')!;
    const second = extension.views.snapshot('v1')!;
    expect(first.objects.fog).toBe(scene.objects.fog);
    expect(first.widgets.settings).toBe(scene.widgets.settings);
    expect(first.lighting).toBe(scene.lighting);
    expect(first.objects).not.toBe(second.objects);
    expect(Object.keys(first.objects).sort()).toEqual(['drawings', 'fog', 'texts', 'tokens']);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.objects)).toBe(true);
  });

  it('C-views-3: list shows the map views; active is the active one, or null', () => {
    const { atlas, extension } = connected();
    atlas.views.open('v1');
    atlas.views.open('v2');
    expect(extension.views.list().map((info) => info.viewId)).toEqual(['v1', 'v2']);
    expect(extension.views.list().every((info) => info.kind === 'map')).toBe(true);
    expect(extension.views.active()).toBeNull();
    atlas.views.setActive('v2');
    expect(extension.views.active()?.viewId).toBe('v2');
    atlas.views.close('v2');
    expect(extension.views.active()).toBeNull();
  });

  it('C-views-4: map-loaded fires once per load, map-closed once on close', () => {
    const { atlas, extension } = connected();
    const loadedSpy = vi.fn();
    const closed = vi.fn();
    extension.on('map-loaded', loadedSpy);
    extension.on('map-closed', closed);
    atlas.views.setSnapshot('v1', loaded());
    atlas.views.setSnapshot('v1', loaded());
    expect(loadedSpy).toHaveBeenCalledTimes(1);
    expect(loadedSpy.mock.calls[0]![0]).toMatchObject({ viewId: 'v1', kind: 'map', mapPath: MAP, loaded: true });
    atlas.views.close('v1');
    atlas.views.close('v1');
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith('v1');
  });

  it('C-views-5: camera is null without a viewport, and watchCamera is a harmless no-op', () => {
    const { atlas, extension } = connected();
    atlas.views.open('v1');
    expect(extension.views.camera('v1')).toBeNull();
    const stop = extension.views.watchCamera('v1', () => undefined);
    stop();
    stop();
  });

  it('C-views-6: closing a view disposes its subscribe and watchCamera registrations; nothing fires after', () => {
    const { atlas, extension } = connected();
    atlas.views.setSnapshot('v1', loaded());
    atlas.views.setCamera('v1', { centerX: 1, centerY: 1, width: 10, height: 10 });
    const snapshots = vi.fn();
    const cameras = vi.fn();
    const stop = extension.views.subscribe('v1', snapshots);
    extension.views.watchCamera('v1', cameras);
    expect(atlas.listenerCount()).toBe(2);
    atlas.views.close('v1');
    expect(atlas.listenerCount()).toBe(0);
    expect(atlas.views.cameraWatchCount('v1')).toBe(0);
    expect(() => stop()).not.toThrow();
    expect(snapshots).not.toHaveBeenCalled();
    expect(cameras).not.toHaveBeenCalled();
  });

  it('C-views-7: a throwing listener is logged and stops neither the store nor later subscribers', () => {
    const { atlas, extension } = connected();
    atlas.views.setSnapshot('v1', loaded());
    atlas.views.setCamera('v1', { centerX: 1, centerY: 1, width: 10, height: 10 });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const later = vi.fn();
    extension.views.subscribe('v1', () => { throw new Error('boom'); });
    extension.views.subscribe('v1', later);
    extension.views.watchCamera('v1', () => { throw new Error('boom'); });
    expect(() => atlas.views.update('v1', { background: 'maps/a.png' })).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
    expect(() => atlas.views.frame('v1')).not.toThrow();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('C-rules-1: outside a collection forMap gives Atlas defaults; inside, the collection rules with the GM cone angle', () => {
    const { atlas, extension } = connected();
    const outside = extension.rules.forMap(null);
    expect(outside.collectionId).toBeNull();
    expect(outside.gridDefaults).toBeNull();
    expect(outside.measurement.coneAngle).toBe(DEFAULT_CONE_ANGLE);
    expect(outside.dice).toEqual(DEFAULT_DICE_RULES);
    atlas.rules.saveCollection('c1', {
      maps: [MAP], gridDefaults: { unitType: 'feet', unitDistance: 5, measurementMode: 'metric', coneAngle: 60 },
      conditions: [{ id: 'k', name: 'Stunned', color: '#ff0000' }],
    });
    expect(extension.rules.forMap('maps/loose.atlasmap').collectionId).toBeNull();
    const inside = extension.rules.forMap(MAP);
    expect(inside.collectionId).toBe('c1');
    expect(inside.measurement.coneAngle).toBe(60);
    expect(inside.conditions.map((condition) => condition.name)).toEqual(['Stunned']);
    expect(Object.isFrozen(inside)).toBe(true);
  });

  it('C-rules-2: rules-changed fires with the collection id when its settings are saved', () => {
    const { atlas, extension } = connected();
    const listener = vi.fn();
    const stop = extension.on('rules-changed', listener);
    atlas.rules.saveCollection('c1', { maps: [MAP] });
    expect(listener).toHaveBeenCalledWith('c1');
    stop();
    atlas.rules.saveCollection('c1', { maps: [MAP] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('C-rules-3: rules-changed fires with null once the asset index has loaded', () => {
    const { atlas, extension } = connected();
    const listener = vi.fn();
    extension.on('rules-changed', listener);
    atlas.rules.indexLoaded();
    expect(listener).toHaveBeenCalledWith(null);
  });

  it('C-rules-4: the result is a deep-frozen copy; mutating it throws and leaves the collection alone', () => {
    const { atlas, extension } = connected();
    atlas.rules.saveCollection('c1', { maps: [MAP], gridDefaults: { unitType: 'feet', unitDistance: 5, measurementMode: 'metric', coneAngle: 60 }, conditions: [{ id: 'k', name: 'Stunned', color: '#ff0000' }] });
    const inside = extension.rules.forMap(MAP);
    expect(() => (inside.conditions as unknown[]).push({})).toThrow(TypeError);
    expect(() => { (inside.gridDefaults as { coneAngle: number }).coneAngle = 1; }).toThrow(TypeError);
    expect(() => { (inside.measurement as { coneAngle: number }).coneAngle = 1; }).toThrow(TypeError);
    expect(extension.rules.forMap(MAP).conditions).toHaveLength(1);
    expect(extension.rules.forMap(MAP).gridDefaults?.coneAngle).toBe(60);
  });

  it('C-rules-5: a collection without grid defaults gives null defaults and the default cone', () => {
    const { atlas, extension } = connected();
    atlas.rules.saveCollection('bare', { maps: [MAP] });
    const rules = extension.rules.forMap(MAP);
    expect(rules.collectionId).toBe('bare');
    expect(rules.gridDefaults).toBeNull();
    expect(rules.measurement.coneAngle).toBe(DEFAULT_CONE_ANGLE);
  });

  it('C-pres-1: present returns false for a closed view; held on tab switch; resumed only after the tab loaded; cleared when the tab closes', async () => {
    const { atlas, extension } = connected();
    const { presentation } = extension;
    atlas.views.open('v1', [{ tabId: 'a', mapPath: MAP, name: 'A' }, { tabId: 'b', mapPath: 'maps/b.atlasmap', name: 'B' }]);
    atlas.views.setSnapshot('v1', loaded());
    const seen: string[] = [];
    presentation.subscribe({
      presented: (scene, resumed) => seen.push(`presented:${scene.tabId}:${resumed}`),
      held: (scene) => seen.push(`held:${scene.tabId}`),
      cleared: () => seen.push('cleared'),
    });
    expect(await presentation.present('v1', 'a')).toBe(true);
    expect(presentation.current()).toMatchObject({ viewId: 'v1', tabId: 'a', mapPath: MAP, held: false });
    expect(Object.isFrozen(presentation.current())).toBe(true);
    atlas.views.setActiveTab('v1', 'b');
    expect(seen.at(-1)).toBe('held:a');
    atlas.views.update('v1', { loaded: false });
    atlas.views.setActiveTab('v1', 'a');
    await Promise.resolve();
    expect(seen.at(-1)).toBe('held:a'); // still loading: no resume
    atlas.views.update('v1', { loaded: true });
    await Promise.resolve();
    expect(seen.at(-1)).toBe('presented:a:true');
    atlas.views.removeTab('v1', 'a');
    expect(seen.at(-1)).toBe('cleared');
    atlas.views.close('v1');
    expect(await presentation.present('v1')).toBe(false);
  });

  it('present waits for a loading tab and then presents it, as Atlas does: no hold, no resume', async () => {
    const { atlas, extension } = connected();
    atlas.views.open('v1', [{ tabId: 'a', mapPath: MAP, name: 'A' }, { tabId: 'b', mapPath: 'maps/b.atlasmap', name: 'B' }]);
    atlas.views.setSnapshot('v1', loaded());
    const seen: string[] = [];
    extension.presentation.subscribe({
      presented: (scene, resumed) => seen.push(`presented:${scene.tabId}:${resumed}`),
      held: (scene) => seen.push(`held:${scene.tabId}`),
    });
    const presenting = extension.presentation.present('v1', 'b');
    atlas.views.update('v1', { mapPath: 'maps/b.atlasmap', loaded: false });
    expect(seen).toEqual([]);
    atlas.views.update('v1', { loaded: true });
    expect(await presenting).toBe(true);
    expect(seen).toEqual(['presented:b:false']);
    const gone = extension.presentation.present('v1', 'a');
    atlas.views.close('v1');
    expect(await gone).toBe(false);
  });
});
