import { describe, expect, it, vi } from 'vitest';
import type { RemoteSceneInput } from '@atlas-vtt/api-types';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

function setup() {
  const atlas = new FakeAtlas({ capabilities: ['views', 'lasers', 'remote-view'] });
  const plugin = connectingPlugin('atlas-vtt-connect');
  const extension = atlas.connect(plugin);
  return { atlas, plugin, extension, remoteViews: extension.remoteViews! };
}

const tokenScene = (): RemoteSceneInput => ({
  background: { url: null, width: 1000, height: 800 },
  grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 1, snapToGrid: true },
  objects: {
    tokens: {
      mine: { id: 'mine', kind: 'token', x: 105, y: 105, imagePath: '', size: 1 },
      theirs: { id: 'theirs', kind: 'token', x: 315, y: 105, imagePath: '', size: 1 },
    },
    texts: {}, drawings: {}, fog: {},
  },
  tokenImages: {},
  widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
  initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } },
});

describe('FakeAtlas follows the remote view contract cases', () => {
  it('C-remote-1: open with reuse reveals the same tab; close fires onClose once; the view is never active() and never saved', async () => {
    const { atlas, extension, remoteViews } = setup();
    const first = await remoteViews.open({ title: 'Online scene', icon: 'network', reuse: true });
    const again = await remoteViews.open({ title: 'Online scene', reuse: true });
    expect(again.viewId).toBe(first.viewId);
    const other = await remoteViews.open({ title: 'Online scene' });
    expect(other.viewId).not.toBe(first.viewId);
    const closed = vi.fn();
    first.onClose(closed);
    expect(extension.views.list().find((info) => info.viewId === first.viewId)?.kind).toBe('remote');
    atlas.views.setActive(first.viewId);
    expect(extension.views.active()).toBeNull();
    // Never saved: the view's map path names no vault file (Atlas's own test checks its store is inert).
    first.setScene(tokenScene());
    expect(extension.views.list().find((info) => info.viewId === first.viewId)?.mapPath).toBe(`remote:${first.viewId}`);
    first.close();
    first.close();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(extension.views.list().map((info) => info.viewId)).not.toContain(first.viewId);
    // Every method does nothing once the view closed.
    expect(() => first.setScene(null)).not.toThrow();
    await expect(remoteViews.open({ title: '' })).rejects.toThrow(/title/);
    await expect(remoteViews.open({ title: 'X', maxDice: 101 })).rejects.toThrow(/maxDice/);
  });

  it('C-remote-2: unloading the extension or Atlas closes its remote views', async () => {
    const { atlas, plugin, remoteViews } = setup();
    const view = await remoteViews.open({ title: 'X' });
    const closed = vi.fn();
    view.onClose(closed);
    plugin.unload();
    expect(closed).toHaveBeenCalledTimes(1);
    const again = await atlas.connect(connectingPlugin('atlas-vtt-connect')).remoteViews!.open({ title: 'X' });
    const closedToo = vi.fn();
    again.onClose(closedToo);
    atlas.unload();
    expect(closedToo).toHaveBeenCalledTimes(1);
    expect(atlas.remoteViews.all().every((handle) => handle.closed)).toBe(true);
  });

  it('C-remote-4: onTokenDrop fires for movable ids only, at the snapped point; lasers work in the remote view; onCameraMoved after a pan or Fit map', async () => {
    const { atlas, extension, remoteViews } = setup();
    const view = await remoteViews.open({ title: 'X' });
    const handle = atlas.remoteViews.latest();
    view.setScene(tokenScene());
    view.setPlayer({
      movableTokenIds: ['mine'],
      measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 90 },
      tokenUi: { conditions: [], resources: {} }, initiative: { rules: null, health: {} },
    });
    // API 1.14.0: a measurement without a rules square takes the distance per cell; one not above 0 is refused.
    expect(handle.player?.measurement.ruleDistance).toBe(5);
    expect(() => view.setPlayer({ ...handle.player!, measurement: { ...handle.player!.measurement, ruleDistance: 0 } })).toThrow(/"measurement" must be/);
    const drops = vi.fn();
    view.onTokenDrop(drops);
    handle.drop('theirs', { x: 400, y: 400 });
    handle.drop('mine', { x: 200, y: 190 });
    expect(drops.mock.calls).toEqual([[{ tokenId: 'mine', x: 175, y: 175 }]]);
    expect(Object.isFrozen(drops.mock.calls[0]?.[0])).toBe(true);
    // The GM's laser API takes the remote view's id.
    const local = vi.fn();
    extension.lasers.onLocal(view.viewId, local);
    atlas.lasers.emitLocal(view.viewId, { kind: 'point', x: 1, y: 2 });
    expect(local).toHaveBeenCalledWith({ kind: 'point', x: 1, y: 2 });
    extension.lasers.show(view.viewId, { from: 'p1', color: '#ff0000', points: [{ x: 1, y: 2 }], lifted: false });
    expect(atlas.lasers.shown(view.viewId)).toHaveLength(1);
    // The camera: set by the owner, moved by the player or Fit map.
    const moved = vi.fn();
    view.onCameraMoved(moved);
    view.setCamera({ centerX: 10, centerY: 20, width: 300, height: 200 }, { animate: true });
    expect(handle.cameras).toEqual([{ camera: { centerX: 10, centerY: 20, width: 300, height: 200 }, animate: true, padded: false }]);
    handle.moveCamera(true);
    handle.moveCamera(false);
    expect(moved.mock.calls).toEqual([[true], [false]]);
    expect(() => view.setCamera({ centerX: 0, centerY: 0, width: 0, height: 10 })).toThrow(/size above 0/);
  });

  it('API 1.15: status actions (at most 3 buttons in all, distinct ids) reach onStatusAction by id, never the action', async () => {
    const { atlas, extension } = setup();
    const view = await extension.remoteViews!.open({ title: 'Online scene' });
    const handle = atlas.remoteViews.latest();
    const base = { title: 'T', connection: 'Connected', tone: 'connected', message: null } as const;
    const chosen = vi.fn();
    const stop = view.onStatusAction!(chosen);
    const run = vi.fn();
    view.setStatus({ ...base, action: { label: 'Reconnect', run }, actions: [{ id: 'a', label: 'A', icon: 'inbox' }] });
    handle.chooseStatusAction('a');
    handle.chooseStatusAction('unknown');
    expect(chosen.mock.calls).toEqual([['a']]);
    expect(run).not.toHaveBeenCalled();
    expect(() => view.setStatus({ ...base, action: { label: 'R', run }, actions: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] })).toThrow(/actions/);
    expect(() => view.setStatus({ ...base, actions: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] })).toThrow(/actions/);
    expect(() => view.setStatus({ ...base, actions: [{ id: '', label: 'A' }] })).toThrow(/actions/);
    expect(() => view.setStatus({ ...base, actions: [{ id: 'a', label: 'A', icon: '' }] })).toThrow(/actions/);
    stop();
    handle.chooseStatusAction('a');
    expect(chosen).toHaveBeenCalledOnce();
  });

  it('API 1.15: setCamera padded is recorded; an Atlas before 1.15 has no onStatusAction and ignores padded', async () => {
    const { atlas, extension } = setup();
    const view = await extension.remoteViews!.open({ title: 'Online scene' });
    view.setCamera({ centerX: 1, centerY: 2, width: 3, height: 4 }, { padded: true });
    expect(atlas.remoteViews.latest().cameras.at(-1)).toMatchObject({ padded: true, animate: false });
    const old = new FakeAtlas({ capabilities: ['views', 'remote-view'], before115: true });
    const oldView = await old.connect(connectingPlugin('atlas-vtt-connect')).remoteViews!.open({ title: 'Online scene' });
    oldView.setCamera({ centerX: 1, centerY: 2, width: 3, height: 4 }, { padded: true });
    expect(old.remoteViews.latest().cameras.at(-1)?.padded).toBe(false);
    expect(oldView.onStatusAction).toBeUndefined();
    expect(old.version).toBe('1.14.0');
  });
});
