import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presentedSource, presentedTab } from '../../../src/app/online/atlas/presentedSource';
import { sessionDeps } from '../../../src/app/online/atlas/sessionDeps';
import { createTabScenes, type TabScenes } from '../../../src/app/online/atlas/tabScenes';
import type { TabKey } from '../../../src/app/online/split/tabKey';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';

const A = 'maps/a.atlasmap';
const B = 'maps/b.atlasmap';
const C = 'maps/c.atlasmap';

/** A fake Atlas with scene tabs and the GM's view `v1` of tabs a, b and c, a active and loaded. */
async function setup(): Promise<{ atlas: FakeAtlas; ext: ReturnType<FakeAtlas['connect']>; tabs: TabScenes; lives: Array<TabKey | null>; closes: TabKey[][] }> {
  const atlas = new FakeAtlas({ capabilities: ['views', 'presentation', 'rules', 'settings', 'scene-tabs'] });
  atlas.views.open('v1', [{ tabId: 'a', mapPath: A, name: 'A' }, { tabId: 'b', mapPath: B, name: 'B' }, { tabId: 'c', mapPath: C, name: 'C' }]);
  atlas.views.update('v1', { mapPath: A, loaded: true });
  atlas.views.setActive('v1');
  const ext = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  await vi.advanceTimersByTimeAsync(0);
  const tabs = createTabScenes(ext);
  const lives: Array<TabKey | null> = [];
  const closes: TabKey[][] = [];
  tabs.subscribeLive((live) => lives.push(live));
  tabs.subscribeTabs((closed) => closes.push(closed));
  return { atlas, ext, tabs, lives, closes };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('TabScenes', () => {
  it('lists the GM\'s tabs with their names, and no remote view', async () => {
    const { atlas, tabs } = await setup();
    atlas.views.openRemote('r1');
    expect(tabs.tabs()).toEqual([
      { viewId: 'v1', tabId: 'a', mapPath: A, name: 'A' },
      { viewId: 'v1', tabId: 'b', mapPath: B, name: 'B' },
      { viewId: 'v1', tabId: 'c', mapPath: C, name: 'C' },
    ]);
    expect(tabs.tab({ viewId: 'v1', tabId: 'b' })).toMatchObject({ name: 'B' });
    expect(tabs.tab({ viewId: 'v1', tabId: 'z' })).toBeNull();
    expect(tabs.liveTab()).toEqual({ viewId: 'v1', tabId: 'a' });
  });

  it('names no live tab while the next tab loads, even though activeTabId already changed', async () => {
    const { atlas, ext, tabs, lives } = await setup();
    const switched = atlas.views.switchTab('v1', 'b', { loadDelayMs: 50 });
    expect(ext.views.list()[0]!.activeTabId).toBe('b');
    // The store still holds a's scene, loaded: it is no tab's, neither a's nor b's.
    expect(ext.views.snapshot('v1')).toMatchObject({ mapPath: A, loaded: true });
    expect(tabs.liveTab()).toBeNull();
    expect(tabs.liveSnapshot({ viewId: 'v1', tabId: 'a' })).toBeNull();
    expect(tabs.liveSnapshot({ viewId: 'v1', tabId: 'b' })).toBeNull();
    expect(lives).toEqual([null]);
    await vi.advanceTimersByTimeAsync(10);
    expect(tabs.liveTab()).toBeNull();
    await vi.advanceTimersByTimeAsync(50);
    await switched;
    expect(tabs.liveTab()).toEqual({ viewId: 'v1', tabId: 'b' });
    expect(tabs.liveSnapshot({ viewId: 'v1', tabId: 'b' })).toMatchObject({ mapPath: B, tabId: 'b' });
    expect(lives).toEqual([null, { viewId: 'v1', tabId: 'b' }]);
  });

  it('reads the snapshot anew at every call, never a cached one', async () => {
    const { atlas, ext } = await setup();
    const snapshot = vi.fn(ext.views.snapshot);
    const tabs = createTabScenes({ on: ext.on, views: { ...ext.views, snapshot } });
    snapshot.mockClear();
    tabs.liveTab();
    tabs.liveTab();
    expect(snapshot).toHaveBeenCalledTimes(2);
    atlas.views.update('v1', { loaded: false });
    expect(tabs.liveTab()).toBeNull();
    tabs.dispose();
  });

  it('reports the closed background tab from tabs-changed', async () => {
    const { atlas, tabs, closes, lives } = await setup();
    atlas.views.closeTab('v1', 'c');
    await vi.advanceTimersByTimeAsync(0);
    expect(closes).toEqual([[{ viewId: 'v1', tabId: 'c' }]]);
    expect(tabs.tabs().map((tab) => tab.tabId)).toEqual(['a', 'b']);
    // A background tab closing changes nothing live.
    expect(lives).toEqual([]);
  });

  it('reports every tab of a closed view, and no live tab after it', async () => {
    const { atlas, tabs, closes, lives } = await setup();
    atlas.views.close('v1');
    expect(closes).toEqual([[{ viewId: 'v1', tabId: 'a' }, { viewId: 'v1', tabId: 'b' }, { viewId: 'v1', tabId: 'c' }]]);
    expect(tabs.tabs()).toEqual([]);
    expect(lives).toEqual([null]);
  });

  it('follows a rename without reporting a close', async () => {
    const { atlas, tabs, closes } = await setup();
    atlas.views.renameTab('v1', 'b', 'Cave', 'maps/cave.atlasmap');
    await vi.advanceTimersByTimeAsync(0);
    expect(closes).toEqual([[]]);
    expect(tabs.tab({ viewId: 'v1', tabId: 'b' })).toEqual({ viewId: 'v1', tabId: 'b', mapPath: 'maps/cave.atlasmap', name: 'Cave' });
  });

  it('picks up a map view opened after it started', async () => {
    const { atlas, tabs } = await setup();
    atlas.views.open('v2', [{ tabId: 'x', mapPath: 'maps/x.atlasmap', name: 'X' }]);
    atlas.views.update('v2', { mapPath: 'maps/x.atlasmap', loaded: true });
    expect(tabs.tab({ viewId: 'v2', tabId: 'x' })).toMatchObject({ name: 'X' });
    // The active view's live tab comes first.
    expect(tabs.liveTab()).toEqual({ viewId: 'v1', tabId: 'a' });
  });

  it('show switches without presenting, and answers false when overtaken', async () => {
    const { atlas, ext, tabs } = await setup();
    await atlas.presentation.present('v1', 'a');
    atlas.views.setLoadDelay(50);
    const first = tabs.show({ viewId: 'v1', tabId: 'b' });
    await vi.advanceTimersByTimeAsync(10);
    const second = tabs.show({ viewId: 'v1', tabId: 'c' });
    await vi.advanceTimersByTimeAsync(100);
    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(tabs.liveTab()).toEqual({ viewId: 'v1', tabId: 'c' });
    expect(ext.presentation.current()).toMatchObject({ tabId: 'a', held: true });
    await expect(tabs.show({ viewId: 'v1', tabId: 'nope' })).resolves.toBe(false);
  });

  it('leaves nothing registered once disposed', async () => {
    const { atlas, tabs, lives } = await setup();
    const before = atlas.listenerCount();
    tabs.dispose();
    expect(atlas.listenerCount()).toBeLessThan(before);
    atlas.views.close('v1');
    expect(lives).toEqual([]);
    // Only what the fake's own connection holds is left: no tab listener, no view subscription.
    const fresh = await setup();
    const base = fresh.atlas.listenerCount();
    fresh.tabs.dispose();
    expect(fresh.atlas.listenerCount()).toBe(base - 4);
  });

  it('is built per session only with scene-tabs, and presentedTab names the presented tab', async () => {
    const { atlas, ext } = await setup();
    const deps = sessionDeps(ext, { dice: null, lasers: null, lighting: null, tokens: null, sceneTabs: true });
    expect(typeof deps.tabScenes).toBe('function');
    deps.tabScenes!().dispose();
    expect(sessionDeps(ext, { dice: null, lasers: null, lighting: null, tokens: null })).not.toHaveProperty('tabScenes');
    const source = presentedSource(ext);
    expect(presentedTab(source)).toBeNull();
    await atlas.presentation.present('v1', 'a');
    expect(presentedTab(source)).toEqual({ viewId: 'v1', tabId: 'a' });
  });
});
