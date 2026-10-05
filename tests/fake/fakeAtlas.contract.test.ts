import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

const source = JSON.parse(readFileSync('vendor/atlas/SOURCE.json', 'utf8')) as { contractCases: string[] };
/** Cases only Atlas can show (rendering, Atlas's own UI); each with why the fake leaves it out. */
export const ATLAS_ONLY: Record<string, string> = {
  'C-life-4': 'Atlas-internal DisposerSet; the fake disposers are trivially idempotent',
  'C-settings-2': 'Atlas-internal: needs the player view switch and the dice look screens, which the fake does not have',
  'C-storage-3': 'Atlas-internal: a failed folder creation needs the vault adapter; the fake has no vault',
  'C-storage-4': 'Atlas-internal: a folder deleted after the first call needs the vault adapter; the fake has no vault',
  'C-pres-2': 'Atlas-internal: the eye of a target is Atlas UI',
  'C-rules-6': "Atlas-internal: needs Atlas's settings service and its user system presets",
  'C-rules-7': "Atlas-internal: the asset index's own loading and its failure log",
  'C-remote-3': "Atlas-internal (the plan's Appendix A): setScene in the remote view's store snapshot",
  'C-remote-5': "Atlas-internal (the plan's Appendix A): the remote view's dice tray and log are Atlas UI",
};

/**
 * Cases a later task simulates, each with its owner: the remote view (`remoteViews`, 1.12.0) is B15's, which brings it
 * into Connect. The fake already lists a remote view among the views (`FakeViews.openRemote`), as 1.12.0 does.
 */
export const LATER_TASK: Record<string, string> = {
  'C-remote-1': 'B15: remoteViews.open, reuse and onClose',
  'C-remote-2': 'B15: unloading closes the remote views',
  'C-remote-4': 'B15: token drops, lasers and camera moves in a remote view',
};

describe('FakeAtlas follows the contract cases', () => {
  it('C-storage-1: folder() is the extension folder and is stable', async () => {
    const atlas = new FakeAtlas({ capabilities: ['storage'] });
    const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    expect(await extension.storage.folder()).toBe('atlas-vtt/.atlas-data/extensions/atlas-vtt-connect');
    expect(await extension.storage.folder()).toBe('atlas-vtt/.atlas-data/extensions/atlas-vtt-connect');
  });
  it('C-storage-2: an id outside kebab-case rejects in folder(), not at connect', async () => {
    const atlas = new FakeAtlas({ capabilities: ['storage'] });
    const extension = atlas.connect(connectingPlugin('Not Kebab'));
    await expect(extension.storage.folder()).rejects.toThrow(/kebab-case/);
  });
  it('C-settings-1: playerView has the four rules and settings-changed names the key', () => {
    const atlas = new FakeAtlas({ capabilities: ['settings'] });
    const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    expect(Object.keys(extension.settings.get('playerView')).sort()).toEqual(['showGrid', 'showInitiative', 'showTokenNameplates', 'showWidgets']);
    const keys: string[] = [];
    extension.on('settings-changed', (key) => keys.push(key));
    atlas.setSetting('laserPointer', { color: '#f00', size: 2 });
    atlas.setSetting('laserPointer', { color: '#f00', size: 2 });
    expect(keys).toEqual(['laserPointer']);
  });
  it('C-settings-3: get returns a frozen copy, and refuses a key that is not a setting', () => {
    const atlas = new FakeAtlas({ capabilities: ['settings'] });
    const { settings } = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    const laser = settings.get('laserPointer');
    expect(Object.isFrozen(laser)).toBe(true);
    atlas.setSetting('laserPointer', { color: '#00f', size: 5 });
    expect(laser).toEqual({ color: '#ff0000', size: 3 });
    expect(() => settings.get('nope' as never)).toThrow(/Unknown setting/);
  });
  it('C-life-1: connecting again with the same id disposes the first connection', () => {
    const atlas = new FakeAtlas();
    const plugin = connectingPlugin('x');
    const listener = vi.fn();
    atlas.connect(plugin).on('unload', listener);
    atlas.connect(plugin);
    expect(atlas.listenerCount()).toBe(0);
    atlas.unload();
    expect(listener).not.toHaveBeenCalled();
    expect(atlas.connectedIds).toEqual(['x', 'x']);
  });
  it('C-life-2: unloading the extension leaves no listener behind', () => {
    const atlas = new FakeAtlas();
    const plugin = connectingPlugin('x');
    const listener = vi.fn();
    atlas.connect(plugin).on('unload', listener);
    expect(atlas.listenerCount()).toBe(1);
    plugin.unload();
    expect(atlas.listenerCount()).toBe(0);
    atlas.unload();
    expect(listener).not.toHaveBeenCalled();
  });
  it('C-life-2: an old plugin object unloading does not tear down a newer one with the same id', () => {
    const atlas = new FakeAtlas();
    const oldPlugin = connectingPlugin('x');
    const newPlugin = connectingPlugin('x');
    atlas.connect(oldPlugin);
    atlas.connect(newPlugin).on('unload', () => undefined);
    oldPlugin.unload();
    expect(atlas.listenerCount()).toBe(1);
    newPlugin.unload();
    expect(atlas.listenerCount()).toBe(0);
  });
  it('C-life-3: Atlas unloading tells every extension in order, disposes everything, then triggers api-unload', () => {
    const triggered: string[] = [];
    const atlas = new FakeAtlas({ trigger: (name) => triggered.push(name) });
    const order: string[] = [];
    atlas.connect(connectingPlugin('a')).on('unload', () => order.push('a'));
    atlas.connect(connectingPlugin('b')).on('unload', () => order.push('b'));
    atlas.unload();
    expect(order).toEqual(['a', 'b']);
    expect(atlas.listenerCount()).toBe(0);
    expect(triggered).toEqual(['atlas-vtt:api-unload']);
    expect(() => atlas.connect(connectingPlugin('c'))).toThrow(/unloaded/);
  });
  it('C-life-5: has() is true only for landed capabilities', () => {
    const atlas = new FakeAtlas({ capabilities: ['views'] });
    expect(atlas.has('views')).toBe(true);
    expect(atlas.has('remote-view')).toBe(false);
    expect(atlas.has('nonsense' as never)).toBe(false);
  });

  it('C-views-3: a remote view (1.12.0) is listed and announced as kind remote, and is never active', () => {
    const atlas = new FakeAtlas({ capabilities: ['views'] });
    const extension = atlas.connect(connectingPlugin('ext'));
    const loaded = vi.fn();
    const closed = vi.fn();
    extension.on('map-loaded', loaded);
    extension.on('map-closed', closed);
    atlas.views.open('gm');
    atlas.views.openRemote('r1');
    atlas.views.setSnapshot('r1', { ...atlas.views.sceneOf('r1')!, mapPath: 'remote:r1', loaded: true });
    atlas.views.setActive('r1');
    expect(extension.views.list().map((info) => [info.viewId, info.kind])).toEqual([['gm', 'map'], ['r1', 'remote']]);
    expect(loaded).toHaveBeenCalledWith(expect.objectContaining({ viewId: 'r1', kind: 'remote', mapPath: 'remote:r1' }));
    expect(extension.views.active()).toBeNull();
    atlas.views.close('r1');
    expect(closed).toHaveBeenCalledWith('r1');
  });

  it('every case Atlas pins is tested here, listed as Atlas-only, or owned by a later task', () => {
    const text = readdirSync('tests/fake').filter((name) => name.endsWith('.contract.test.ts'))
      .map((name) => readFileSync(`tests/fake/${name}`, 'utf8')).join('\n');
    const tested = new Set([...text.matchAll(/^\s*it\('(C-[a-z]+-[0-9]+):/gm)].map((match) => match[1]));
    const missing = source.contractCases.filter((id) => !ATLAS_ONLY[id] && !LATER_TASK[id] && !tested.has(id));
    expect(missing).toEqual([]);
    expect([...Object.keys(ATLAS_ONLY), ...Object.keys(LATER_TASK)].filter((id) => !source.contractCases.includes(id))).toEqual([]);
    // A case a later task owns is not tested here yet: once it is, its entry goes.
    expect(Object.keys(LATER_TASK).filter((id) => tested.has(id) || ATLAS_ONLY[id])).toEqual([]);
  });
});
