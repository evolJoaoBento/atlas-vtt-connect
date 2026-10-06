import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasCapability, SceneSnapshot, ViewInfo } from '@atlas-vtt/api-types';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';
import { SHOW_TAB_TIMEOUT_MS } from './fakeViews';

const A = 'maps/a.atlasmap';
const B = 'maps/b.atlasmap';
const C = 'maps/c.atlasmap';
const TABS: readonly AtlasCapability[] = ['views', 'presentation', 'ui', 'scene-tabs'];

/** Lets queued microtasks (the coalesced `tabs-changed`, a switch's first step) run. */
const flush = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); };

type Tabbed = { atlas: FakeAtlas; ext: ReturnType<FakeAtlas['connect']>; plugin: ReturnType<typeof connectingPlugin> };

/** A fake Atlas with one GM map view `v1` of tabs a, b and c, the first active and loaded; its own 'tabs-changed' has fired. */
async function tabbed(capabilities: readonly AtlasCapability[] = TABS): Promise<Tabbed> {
  const atlas = new FakeAtlas({ capabilities });
  atlas.views.open('v1', [{ tabId: 'a', mapPath: A, name: 'A' }]);
  atlas.views.addTab('v1', { tabId: 'b', mapPath: B, name: 'B' });
  atlas.views.addTab('v1', { tabId: 'c', mapPath: C, name: 'C' });
  atlas.views.update('v1', { mapPath: A, loaded: true });
  const plugin = connectingPlugin('ext');
  const ext = atlas.connect(plugin);
  await Promise.resolve();
  return { atlas, ext, plugin };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('FakeAtlas scene tabs (API 1.17.0)', () => {
  it('C-tabs-1: tabs-changed fires once per view after a background tab closes, a rename and a switch, coalesced', async () => {
    const { atlas, ext } = await tabbed();
    const calls: ViewInfo[] = [];
    ext.on('tabs-changed', (info) => { calls.push(info); });
    atlas.views.closeTab('v1', 'c');
    expect(calls).toHaveLength(0);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ viewId: 'v1', kind: 'map', activeTabId: 'a' });
    expect(calls[0]!.tabs.map((tab) => tab.mapPath)).toEqual([A, B]);

    atlas.views.renameTab('v1', 'b', 'Tavern', 'maps/tavern.atlasmap');
    atlas.views.setActiveTab('v1', 'b');
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ activeTabId: 'b' });
    expect(calls[1]!.tabs.map((tab) => tab.name)).toEqual(['A', 'Tavern']);

    // Nothing changed: nothing fires.
    atlas.views.setActiveTab('v1', 'b');
    await flush();
    expect(calls).toHaveLength(2);
  });

  it('C-tabs-1: never fires for a remote view, nor without the scene-tabs capability', async () => {
    const { atlas, ext } = await tabbed();
    const heard = vi.fn();
    ext.on('tabs-changed', heard);
    atlas.views.openRemote('r1');
    atlas.views.setSnapshot('r1', { ...atlas.views.sceneOf('r1')!, mapPath: 'remote:r1', loaded: true });
    await flush();
    expect(heard).not.toHaveBeenCalled();

    const older = await tabbed(['views']);
    const old = vi.fn();
    older.ext.on('tabs-changed', old);
    older.atlas.views.closeTab('v1', 'c');
    await flush();
    expect(old).not.toHaveBeenCalled();
  });

  it('C-tabs-2: tabId is null while the next tab loads, and its id once loaded; activeTabId runs ahead of the store', async () => {
    const { atlas, ext } = await tabbed();
    expect(ext.views.snapshot('v1')!.tabId).toBe('a');
    const seen: Array<{ tabId: string | null | undefined; mapPath: string | null; loaded: boolean }> = [];
    ext.views.subscribe('v1', (snapshot: SceneSnapshot) => seen.push({ tabId: snapshot.tabId, mapPath: snapshot.mapPath, loaded: snapshot.loaded }));
    const switched = atlas.views.switchTab('v1', 'b', { loadDelayMs: 50 });
    // Atlas activates the next tab while the store still holds the previous one's scene: the snapshot names no tab.
    expect(ext.views.list()[0]!.activeTabId).toBe('b');
    expect(ext.views.snapshot('v1')).toMatchObject({ tabId: null, mapPath: A, loaded: true });
    expect(seen).toEqual([{ tabId: null, mapPath: A, loaded: true }]);
    await flush();
    expect(ext.views.snapshot('v1')).toMatchObject({ tabId: null, loaded: false });
    await vi.advanceTimersByTimeAsync(50);
    await switched;
    expect(seen.at(-1)).toEqual({ tabId: 'b', mapPath: B, loaded: true });
    // No snapshot ever named a tab whose scene the store did not hold.
    for (const entry of seen) if (entry.tabId === 'b') expect(entry.mapPath).toBe(B);
    for (const entry of seen) if (entry.tabId === 'a') expect(entry.mapPath).toBe(A);
  });

  it('C-tabs-2: a subscriber hears the active tab closing before any load; a remote view and an older Atlas name no tab', async () => {
    const { atlas, ext } = await tabbed();
    const listener = vi.fn();
    ext.views.subscribe('v1', listener);
    atlas.views.removeTab('v1', 'a');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].tabId).toBeNull();

    atlas.views.openRemote('r1');
    atlas.views.setSnapshot('r1', { ...atlas.views.sceneOf('r1')!, mapPath: 'remote:r1', loaded: true });
    expect(ext.views.snapshot('r1')!.tabId).toBeNull();

    const older = await tabbed(['views']);
    expect(older.ext.views.snapshot('v1')).not.toHaveProperty('tabId');
  });

  it('C-tabs-3: showTab makes a background tab active without presenting it, and answers true once loaded', async () => {
    const { atlas, ext } = await tabbed();
    await atlas.presentation.present('v1', 'a');
    const presented = ext.presentation.current()!;
    const shown = ext.views.showTab!('v1', 'b');
    await flush();
    await expect(shown).resolves.toBe(true);
    expect(ext.views.snapshot('v1')).toMatchObject({ tabId: 'b', mapPath: B, loaded: true });
    // Still the same presentation, held while the GM shows another tab, as on any switch.
    expect(ext.presentation.current()).toEqual({ ...presented, held: true });
    // The active tab, loaded: true at once.
    await expect(ext.views.showTab!('v1', 'b')).resolves.toBe(true);
  });

  it('C-tabs-3: showTab answers false when another switch overtakes it, the GM\'s own included', async () => {
    const { atlas, ext } = await tabbed();
    const first = ext.views.showTab!('v1', 'b');
    const second = ext.views.showTab!('v1', 'c');
    await flush();
    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(ext.views.snapshot('v1')!.tabId).toBe('c');

    const asked = ext.views.showTab!('v1', 'a');
    void atlas.views.switchTab('v1', 'b');
    await flush();
    await expect(asked).resolves.toBe(false);
    expect(ext.views.snapshot('v1')!.tabId).toBe('b');
  });

  it('C-tabs-3: showTab answers false for an unknown tab, an unknown or closed view and a remote view; absent on an older Atlas', async () => {
    const { atlas, ext } = await tabbed();
    atlas.views.open('v2', [{ tabId: 'x', mapPath: A, name: 'X' }]);
    atlas.views.close('v2');
    atlas.views.openRemote('r1');
    await expect(ext.views.showTab!('v1', 'nope')).resolves.toBe(false);
    await expect(ext.views.showTab!('nope', 'a')).resolves.toBe(false);
    await expect(ext.views.showTab!('v2', 'x')).resolves.toBe(false);
    await expect(ext.views.showTab!('r1', 'a')).resolves.toBe(false);
    expect(ext.views.list().find((view) => view.viewId === 'v1')!.activeTabId).toBe('a');
    expect((await tabbed(['views'])).ext.views).not.toHaveProperty('showTab');
  });

  it('C-tabs-3: showTab answers false when the view closes mid-load, and past its 60 s backstop', async () => {
    const { atlas, ext } = await tabbed();
    atlas.views.setLoadDelay(50);
    const shown = ext.views.showTab!('v1', 'b');
    await flush();
    atlas.views.close('v1');
    await expect(shown).resolves.toBe(false);

    const again = await tabbed();
    // A load that never ends (an hour): the answer is false after the backstop.
    again.atlas.views.setLoadDelay(3_600_000);
    const stalled = again.ext.views.showTab!('v1', 'c');
    let answer: boolean | null = null;
    void stalled.then((value) => { answer = value; });
    await vi.advanceTimersByTimeAsync(SHOW_TAB_TIMEOUT_MS - 1);
    expect(answer).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toBe(false);
  });

  it('C-tabmenu-1: a scene tab menu section is read again after invalidate, stays open while ticking, and goes when the extension unloads', async () => {
    const { atlas, ext, plugin } = await tabbed();
    await atlas.presentation.present('v1', 'a');
    let on = false;
    const contexts: unknown[] = [];
    ext.ui.addSceneTabMenuSection!({
      heading: '  Present to  ',
      items: (context) => {
        contexts.push(context);
        return [{ label: 'Anna', checked: on, keepOpen: true, onClick: () => { on = !on; } }, { label: 'Everyone back', onClick: () => undefined }];
      },
    });
    expect(atlas.ui!.sceneTabMenuSections('v1', 'b')).toEqual([{
      heading: 'Present to',
      items: [expect.objectContaining({ label: 'Anna', checked: false, keepOpen: true }), expect.objectContaining({ label: 'Everyone back' })],
    }]);
    expect(contexts.at(-1)).toEqual({ viewId: 'v1', tabId: 'b', mapPath: B, name: 'B', active: false, presented: false });
    const menu = atlas.ui!.openSceneTabMenu('v1', 'b');
    expect(menu.choose('Anna')).toBe(true);
    expect(menu.isOpen).toBe(true);
    // Not read again until the extension invalidates.
    expect(menu.items.find((item) => item.label === 'Anna')?.checked).toBe(false);
    ext.ui.invalidate();
    expect(menu.items.find((item) => item.label === 'Anna')?.checked).toBe(true);
    // The view's tabs changing is read too, and the menu stays open while its tab becomes active.
    await ext.views.showTab!('v1', 'b');
    expect(menu.isOpen).toBe(true);
    expect(menu.items).toHaveLength(2);
    expect(contexts.at(-1)).toMatchObject({ tabId: 'b', active: true });
    expect(menu.choose('Everyone back')).toBe(true);
    expect(menu.isOpen).toBe(false);
    plugin.unload();
    expect(atlas.ui!.sceneTabMenuSections('v1', 'b')).toEqual([]);
    expect(atlas.ui!.sceneTabSectionCount()).toBe(0);
  });

  it('C-tabmenu-1: refuses an empty heading or a section without items; cuts a long heading; leaves out a throwing or empty section; absent on an older Atlas', async () => {
    const { atlas, ext } = await tabbed();
    expect(() => ext.ui.addSceneTabMenuSection!({ heading: '  ', items: () => [] })).toThrow('[Atlas API]');
    expect(() => ext.ui.addSceneTabMenuSection!({ heading: 'H' } as never)).toThrow('[Atlas API]');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ext.ui.addSceneTabMenuSection!({ heading: 'x'.repeat(50), items: () => [{ label: 'One' }] });
    ext.ui.addSceneTabMenuSection!({ heading: 'Empty', items: () => [] });
    ext.ui.addSceneTabMenuSection!({ heading: 'Broken', items: () => { throw new Error('boom'); } });
    expect(atlas.ui!.sceneTabMenuSections('v1', 'a').map((section) => section.heading)).toEqual(['x'.repeat(40)]);
    atlas.ui!.sceneTabMenuSections('v1', 'a');
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
    expect((await tabbed(['views', 'ui'])).ext.ui).not.toHaveProperty('addSceneTabMenuSection');
  });

  it('C-badge-1: tabBadge is read once and called on the target; a throw or a badge too long is handled, a non-function refused', async () => {
    const { atlas, ext } = await tabbed();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let reads = 0;
    const target = {
      id: 'room', label: 'The room', isActive: (): boolean => true, players: 2, fail: false,
      get tabBadge(): (tab: { viewId: string; tabId: string }) => string | null {
        reads++;
        return function (this: { players: number; fail: boolean }, tab) {
          if (this.fail) throw new Error('boom');
          return tab.tabId === 'c' ? `${this.players} players on the far side of the map` : `${this.players} players`;
        };
      },
    };
    const stop = ext.presentation.addTarget(target);
    expect(reads).toBe(1);
    expect(atlas.presentation.badgeFor('v1', 'a')).toBe('2 players');
    expect(atlas.presentation.badgeFor('v1', 'c')).toBe('2 players on the far si…');
    target.fail = true;
    expect(atlas.presentation.badgeFor('v1', 'a')).toBeNull();
    expect(atlas.presentation.badgeFor('v1', 'a')).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(() => ext.presentation.addTarget({ id: 'bad', label: 'Bad', isActive: () => true, tabBadge: 'two' } as never))
      .toThrow('[Atlas API] presentation.addTarget: "tabBadge" must be a function when given.');
    stop();
    expect(atlas.presentation.badgeFor('v1', 'a')).toBeNull();
    error.mockRestore();
  });

  it('reads no tabBadge without the scene-tabs capability, and an inactive target badges nothing', async () => {
    const older = await tabbed(['views', 'presentation']);
    const badge = vi.fn(() => '1 player');
    older.ext.presentation.addTarget({ id: 'room', label: 'Room', isActive: () => true, tabBadge: badge });
    expect(older.atlas.presentation.badgeFor('v1', 'a')).toBeNull();
    expect(badge).not.toHaveBeenCalled();
    const { atlas, ext } = await tabbed();
    ext.presentation.addTarget({ id: 'room', label: 'Room', isActive: () => false, tabBadge: () => '1 player' });
    expect(atlas.presentation.badgeFor('v1', 'a')).toBeNull();
  });

  it('switchTab drops a superseded switch without loading it, and loads a background tab\'s own scene', async () => {
    const { atlas, ext } = await tabbed();
    atlas.views.setTabScene('v1', 'c', { background: 'maps/cave.png' });
    const loads: Array<string | null> = [];
    ext.on('map-loaded', (info) => loads.push(info.mapPath));
    void atlas.views.switchTab('v1', 'b', { loadDelayMs: 30 });
    await flush();
    void atlas.views.switchTab('v1', 'c', { loadDelayMs: 30 });
    await vi.advanceTimersByTimeAsync(100);
    expect(loads).toEqual([C]);
    expect(ext.views.snapshot('v1')).toMatchObject({ tabId: 'c', mapPath: C, background: 'maps/cave.png' });
    // Back on a: the store holds a's scene as it was left.
    atlas.views.update('v1', { background: 'maps/cave-lit.png' });
    await atlas.views.switchTab('v1', 'a');
    expect(ext.views.snapshot('v1')).toMatchObject({ tabId: 'a', mapPath: A, background: null });
    await atlas.views.switchTab('v1', 'c');
    expect(ext.views.snapshot('v1')).toMatchObject({ tabId: 'c', background: 'maps/cave-lit.png' });
  });
});
