/** Which tab shows a joined session: Atlas's remote view when Atlas has `remote-view`, else Connect's Canvas tab. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { OnlineJoinService, type OnlineSceneSink } from '../../../../src/app/online/obsidian/OnlineJoinService';
import { ONLINE_SCENE_VIEW_TYPE } from '../../../../src/app/online/obsidian/onlineSceneTab';
import { openSceneTab } from '../../../../src/app/online/obsidian/sceneTabs';
import { connectingPlugin, FakeAtlas } from '../../../fake/FakeAtlas';
import { memorySettings } from '../../connect/memorySettings';
import { playerScene } from '../sceneFixtures';
import { admitted } from './remoteSceneFixtures';

afterEach(() => { vi.restoreAllMocks(); });

function world(capabilities: readonly AtlasCapability[], session = true) {
  const leaf = { setViewState: vi.fn(async () => undefined) };
  const workspace = { getLeavesOfType: vi.fn(() => []), getLeaf: vi.fn(() => leaf), revealLeaf: vi.fn(async () => undefined) };
  const app = { workspace } as unknown as App;
  const service = new OnlineJoinService(app, memorySettings(), '0.1.0', { openStore: async () => null, isHosting: () => false });
  const sinks: OnlineSceneSink[] = [];
  vi.spyOn(service, 'attach').mockImplementation((sink) => {
    if (!session) return null;
    sinks.push(sink);
    return () => undefined;
  });
  const leave = vi.spyOn(service, 'leave');
  const atlas = new FakeAtlas({ capabilities });
  const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  return { app, atlas, extension, service, sinks, leave, leaf, open: () => openSceneTab(app, atlas, extension) };
}

const WITH_REMOTE: readonly AtlasCapability[] = ['views', 'ui', 'lasers', 'settings', 'remote-view'];

describe('openSceneTab', () => {
  it("opens Atlas's remote view with Connect's title and icon, reused, its tray limited to the wire's 20 dice", async () => {
    const t = world(WITH_REMOTE);
    await t.open();
    const handle = t.atlas.remoteViews.latest();
    expect(handle.options).toEqual({ title: 'Online scene', icon: 'network', reuse: true, maxDice: 20 });
    expect(t.leaf.setViewState).not.toHaveBeenCalled();
    expect(t.sinks).toHaveLength(1);
    t.sinks[0]!.session(admitted());
    t.sinks[0]!.scene(playerScene());
    expect(Object.keys(handle.scene?.objects.tokens ?? {})).toEqual(['t1']);
  });

  it('attaches once to a view it reveals again', async () => {
    const t = world(WITH_REMOTE);
    await t.open();
    await t.open();
    expect(t.atlas.remoteViews.all()).toHaveLength(1);
    expect(t.sinks).toHaveLength(1);
  });

  it("opens Connect's Canvas tab on an Atlas without the remote view", async () => {
    const t = world(['views', 'ui', 'lasers', 'settings']);
    await t.open();
    expect(t.leaf.setViewState).toHaveBeenCalledWith({ type: ONLINE_SCENE_VIEW_TYPE, active: true });
    expect(t.atlas.remoteViews.all()).toHaveLength(0);
  });

  it('falls back to the Canvas tab when the remote view does not open', async () => {
    const t = world(WITH_REMOTE);
    t.atlas.remoteViews.failOpen = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await t.open();
    expect(t.leaf.setViewState).toHaveBeenCalledWith({ type: ONLINE_SCENE_VIEW_TYPE, active: true });
  });

  it('closes the view when there is no session to show, and leaves the session when the player closes it', async () => {
    const none = world(WITH_REMOTE, false);
    await none.open();
    expect(none.atlas.remoteViews.all()[0]?.closed).toBe(true);
    const t = world(WITH_REMOTE);
    await t.open();
    t.atlas.remoteViews.latest().close();
    expect(t.leave).toHaveBeenCalledOnce();
  });
});
