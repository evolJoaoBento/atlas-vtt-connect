import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'obsidian';
import { AtlasLink, LAYOUT_READY_FALLBACK_MS, STOCK_GRACE_MS, STOCK_WATCH_MS } from '../../../src/connect/atlasLink';
import { canShimStockAtlas, stockAtlasApi } from '../../../src/connect/stockAtlas';
import { createTabScenes } from '../../../src/app/online/atlas/tabScenes';
import { fakeConnectPlugin } from '../../fake/fakeWorkspace';
import { setupStockAtlas as setup } from '../../fake/fakeStockAtlas';

describe('stock Atlas stand-in', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('only claims an Atlas whose private shapes it can read', () => {
    expect(canShimStockAtlas(undefined)).toBe(false);
    expect(canShimStockAtlas({})).toBe(false);
    expect(canShimStockAtlas(setup().atlas)).toBe(true);
  });

  it('offers what hosting needs, lighting, the floating ui, tokens, dice and lasers, but no scenes or bundles', () => {
    const { app, atlas } = setup();
    const api = stockAtlasApi(app, atlas);
    expect(api.has('views') && api.has('presentation') && api.has('rules') && api.has('settings') && api.has('storage')).toBe(true);
    expect(api.has('lighting')).toBe(true);
    expect(api.has('ui')).toBe(true);
    expect(api.has('dice')).toBe(true);
    expect(api.has('lasers')).toBe(true);
    expect(api.has('scene-tabs')).toBe(true);
    expect(api.has('tokens')).toBe(true);
  });

  it("hands out how Atlas aligned the map: the grid's stretch, or the shown level's own alignment (Atlas 0.7.1, 0.10)", () => {
    const { app, atlas, a } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    const aligned = (): unknown => (extension.views.snapshot('view-a') as { mapAlignment?: unknown } | null)?.mapAlignment;
    expect(aligned()).toBeNull();
    const grid = { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5, lineType: 'solid', lineWidth: 1 };
    a.scene.set({ grid: { ...grid, mapStretch: { x: 1.1, y: 1.2, rotation: 2 } } } as never);
    expect(aligned()).toEqual({ x: 1.1, y: 1.2, rotation: 2 });
    // A stretch outside Atlas's limits is no stretch, as Atlas draws such a map unstretched.
    a.scene.set({ grid: { ...grid, mapStretch: { x: 3, y: 1 } } } as never);
    expect(aligned()).toBeNull();
    // Several levels: the shown one's alignment, its stretch times its scale, wins over the grid's.
    a.scene.set({
      grid: { ...grid, mapStretch: { x: 1.2, y: 1.2 } },
      levels: [{ id: 'l1' }, { id: 'l2' }], viewedLevel: 'l2',
      levelAlignments: { l2: { stretch: { x: 1, y: 1, rotation: 1 }, scale: 2, offset: { x: 30, y: 0 } } },
    } as never);
    expect(aligned()).toEqual({ x: 2, y: 2, rotation: 1, offset: { x: 30, y: 0 } });
    a.scene.set({ viewedLevel: 'l1' } as never);
    expect(aligned()).toEqual({ x: 1.2, y: 1.2 });
  });

  it("follows a map image Atlas replaced, on the scene's own map and on a level's (Atlas 0.10, 'Replace map image')", () => {
    const { app, atlas, a } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    const background = (): string | null | undefined => (extension.views.snapshot('view-a') as { background?: string | null } | null)?.background;
    const seen: Array<string | null | undefined> = [];
    extension.views.subscribe('view-a', (snapshot) => seen.push((snapshot as { background?: string | null }).background));
    a.scene.set({ background: 'maps/cave.png' } as never);
    expect(background()).toBe('maps/cave.png');
    // The map is replaced by another version of it (gridless, a larger export): the new image reaches players.
    a.scene.set({ background: 'maps/cave-gridless.webp' } as never);
    expect(background()).toBe('maps/cave-gridless.webp');
    // A level's own image: the shown floor's, the first floor's being the scene's own.
    a.scene.set({ levels: [{ id: 'ground', background: null }, { id: 'upper', background: 'maps/upper.png' }], viewedLevel: 'upper' } as never);
    expect(background()).toBe('maps/upper.png');
    a.scene.set({ levels: [{ id: 'ground', background: null }, { id: 'upper', background: 'maps/upper-large.png' }] } as never);
    expect(background()).toBe('maps/upper-large.png');
    expect(seen).toEqual(['maps/cave.png', 'maps/cave-gridless.webp', 'maps/upper.png', 'maps/upper-large.png']);
  });

  it('lists views, reads a snapshot with its tab, and follows store changes', () => {
    const { app, atlas, a } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    expect(extension.views.list()).toEqual([expect.objectContaining({ viewId: 'view-a', kind: 'map', activeTabId: 't1', loaded: true })]);
    expect(extension.views.active()?.viewId).toBe('view-a');
    expect(extension.views.snapshot('view-a')?.tabId).toBe('t1');
    expect(extension.views.snapshot('view-a')?.mapSize).toEqual({ width: 1400, height: 900 });
    expect(extension.views.snapshot('gone')).toBeNull();
    const seen: Array<string | null | undefined> = [];
    extension.views.subscribe('view-a', (snapshot) => seen.push(snapshot.tabId));
    a.scene.set({ initiativeTrackerOpen: true } as never);
    expect(seen).toEqual(['t1']);
    // A tab switch whose map has not loaded yet is no tab's scene.
    a.scene.set({ isMapLoading: true } as never);
    expect(seen.at(-1)).toBeNull();
  });

  it('presents through Atlas: current, held while the GM browses another tab, cleared on stop', async () => {
    const { app, atlas, a, presented } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    const events: string[] = [];
    extension.presentation.subscribe({
      presented: (scene, resumed) => events.push(`presented:${scene.tabId}:${resumed}`),
      held: (scene) => events.push(`held:${scene.tabId}`),
      cleared: (scene) => events.push(`cleared:${scene.tabId}`),
    });
    expect(extension.presentation.current()).toBeNull();
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap' });
    const info = extension.presentation.current();
    expect(info).toMatchObject({ viewId: 'view-a', tabId: 't1', mapPath: 'maps/one.atlasmap', held: false });
    await a.view.switchToTab('t2');
    expect(extension.presentation.current()?.held).toBe(true);
    await a.view.switchToTab('t1');
    expect(extension.presentation.current()?.held).toBe(false);
    expect(extension.presentation.current()?.presentationId).toBe(info?.presentationId);
    extension.presentation.stop();
    expect(events).toEqual(['presented:t1:false', 'held:t1', 'presented:t1:true', 'cleared:t1']);
  });

  it('holds the presented scene while the GM looks at another level than the one shown to players (Atlas 0.10)', () => {
    const { app, atlas, a, presented } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    const events: string[] = [];
    extension.presentation.subscribe({
      presented: (scene, resumed) => events.push(`presented:${scene.tabId}:${resumed}`),
      held: (scene) => events.push(`held:${scene.tabId}`),
      cleared: (scene) => events.push(`cleared:${scene.tabId}`),
    });
    const held = (): boolean | undefined => extension.presentation.current()?.held;
    a.scene.set({ levels: [{ id: 'ground' }, { id: 'upper' }], viewedLevel: 'ground' } as never);
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap' });
    expect(held()).toBe(false);
    // The GM goes upstairs to look: players keep the ground floor, the first, where none is named.
    a.scene.set({ viewedLevel: 'upper' } as never);
    expect(held()).toBe(true);
    // Showing that level on the player view lets players follow: Atlas records it as a new presentation, so not a resume.
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap', levelId: 'upper' });
    expect(held()).toBe(false);
    // The GM goes back down, and the held player view keeps the upper floor until the GM does return to it.
    a.scene.set({ viewedLevel: 'ground' } as never);
    expect(held()).toBe(true);
    a.scene.set({ viewedLevel: 'upper' } as never);
    expect(held()).toBe(false);
    expect(events).toEqual(['presented:t1:false', 'held:t1', 'presented:t1:false', 'held:t1', 'presented:t1:true']);
  });

  it('sends none of a floor the GM only browses: the presented tab is not live then, and returns when players are shown that floor (Atlas 0.10)', () => {
    const { app, atlas, a, presented } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    const tabs = createTabScenes(extension);
    const key = { viewId: 'view-a', tabId: 't1' };
    const tabOf = (): string | null | undefined => extension.views.snapshot('view-a')?.tabId;
    const seen: Array<string | null | undefined> = [];
    extension.views.subscribe('view-a', (snapshot) => seen.push(snapshot.tabId));
    a.scene.set({ levels: [{ id: 'ground' }, { id: 'upper' }], viewedLevel: 'ground' } as never);
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap' });
    expect(tabOf()).toBe('t1');
    expect(tabs.liveSnapshot(key)).not.toBeNull();
    // The GM goes upstairs to look: nothing of that floor is live, and the listeners hear it.
    a.scene.set({ viewedLevel: 'upper' } as never);
    expect(tabOf()).toBeNull();
    expect(tabs.liveSnapshot(key)).toBeNull();
    // Showing that level on the player view makes it live, with nothing changed in the store.
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap', levelId: 'upper' });
    expect(tabOf()).toBe('t1');
    expect(tabs.liveSnapshot(key)).not.toBeNull();
    expect(seen).toContain(null);
    expect(seen.at(-1)).toBe('t1');
    tabs.dispose();
  });

  it('holds nothing for a tab that is not the presented one: a scene of a split group follows its own view', async () => {
    const { app, atlas, a, presented } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap' });
    await a.view.switchToTab('t2');
    a.scene.set({ levels: [{ id: 'ground' }, { id: 'upper' }], viewedLevel: 'upper' } as never);
    expect(extension.views.snapshot('view-a')?.tabId).toBe('t2');
  });

  it('holds nothing for a scene of one level, whatever level is named', () => {
    const { app, atlas, a, presented } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap', levelId: 'upper' });
    expect(extension.presentation.current()?.held).toBe(false);
    a.scene.set({ levels: [{ id: 'only' }], viewedLevel: 'only' } as never);
    expect(extension.presentation.current()?.held).toBe(false);
  });

  it('present() switches to the tab and records it when Atlas has no command for it', async () => {
    const { app, atlas, presented } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    await expect(extension.presentation.present('view-a', 't2')).resolves.toBe(true);
    expect(presented.get()).toEqual({ tabId: 't2', filePath: 'maps/two.atlasmap' });
    await expect(extension.presentation.present('nope', 't2')).resolves.toBe(false);
  });

  it('keeps Atlas from opening a player window while a target is registered', () => {
    const { app, atlas, presented } = setup();
    const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
    const remove = extension.presentation.addTarget({ id: 'online', label: 'online players', isActive: () => true });
    expect(presented.elsewhere()).toBe(1);
    remove();
    expect(presented.elsewhere()).toBe(0);
    expect(() => extension.presentation.addTarget({ id: '', label: 'x', isActive: () => true })).toThrow();
  });

  it('reads the player view rules and reports changes; unloading drops everything', () => {
    const { app, atlas } = setup();
    const plugin = fakeConnectPlugin(app);
    const extension = stockAtlasApi(app, atlas).connect(plugin);
    // The GM's rolls stay private unless the GM shares them (`showDiceRolls`, off by default in Atlas).
    expect(extension.settings.get('playerView')).toEqual({ showGrid: true, showTokenNameplates: false, showWidgets: false, showInitiative: false, showDiceRolls: false, movesOnTurn: false });
    expect(extension.rules.forMap('maps/one.atlasmap').collectionId).toBeNull();
    extension.presentation.addTarget({ id: 'online', label: 'online players', isActive: () => true });
    plugin.unload();
    expect(atlas.presentedScene.elsewhere()).toBe(0);
  });

  it('AtlasLink stands in for a stock Atlas after a short wait, not the whole grace', () => {
    const { app } = setup();
    const started: string[] = [];
    const notices: string[] = [];
    const link = new AtlasLink(fakeConnectPlugin(app as Plugin['app']), (atlas, api) => { started.push(`${atlas.id}:${api.version}`); return () => undefined; }, (m) => notices.push(m));
    link.start();
    expect(started).toEqual([]);
    vi.advanceTimersByTime(STOCK_GRACE_MS);
    expect(started).toEqual(['atlas-vtt-connect:1.0.0']);
    expect(notices).toEqual([]);
  });
  it('follows a stock Atlas that reloads (updated, disabled, enabled): players are shown elsewhere on the new one', () => {
    const { app, plugins, atlas } = setup();
    const events: string[] = [];
    const target = { id: 'online', label: 'Online', isActive: () => true };
    const link = new AtlasLink(fakeConnectPlugin(app as Plugin['app']), (extension) => {
      events.push('start');
      const stop = extension.presentation.addTarget(target);
      return () => { events.push('stop'); stop(); };
    }, () => undefined);
    link.start();
    vi.advanceTimersByTime(STOCK_GRACE_MS);
    expect(events).toEqual(['start']);
    expect(atlas.presentedScene.elsewhere()).toBe(1);
    // Atlas updated in place: a new plugin object with a presented scene of its own, which would open its player window.
    const updated = setup().atlas;
    plugins['atlas-vtt'] = updated as never;
    vi.advanceTimersByTime(STOCK_WATCH_MS);
    expect(events).toEqual(['start', 'stop', 'start']);
    expect(atlas.presentedScene.elsewhere()).toBe(0);
    expect(updated.presentedScene.elsewhere()).toBe(1);
    vi.advanceTimersByTime(STOCK_WATCH_MS * 3);
    expect(events).toEqual(['start', 'stop', 'start']);
    // Disabled, then enabled again.
    plugins['atlas-vtt'] = undefined;
    vi.advanceTimersByTime(STOCK_WATCH_MS);
    expect(events).toEqual(['start', 'stop', 'start', 'stop']);
    expect(link.connected).toBeNull();
    const enabled = setup().atlas;
    plugins['atlas-vtt'] = enabled as never;
    vi.advanceTimersByTime(STOCK_WATCH_MS);
    expect(events).toEqual(['start', 'stop', 'start', 'stop', 'start']);
    expect(enabled.presentedScene.elsewhere()).toBe(1);
  });
  it("stands in even when Obsidian never calls the layout-ready callback (another plugin's threw before it)", () => {
    const { app } = setup();
    (app.workspace as unknown as { onLayoutReady: () => void }).onLayoutReady = () => undefined;
    const started: string[] = [];
    new AtlasLink(fakeConnectPlugin(app as Plugin['app']), (atlas) => { started.push(atlas.id); return () => undefined; }, () => undefined).start();
    vi.advanceTimersByTime(STOCK_GRACE_MS);
    expect(started).toEqual([]);
    vi.advanceTimersByTime(LAYOUT_READY_FALLBACK_MS);
    expect(started).toEqual(['atlas-vtt-connect']);
  });
  describe('showTab (the split party shows a tab without presenting it)', () => {
    /** A view whose tab switch is followed by a load that the test finishes. */
    function loading() {
      const t = setup();
      const extension = stockAtlasApi(t.app, t.atlas).connect(fakeConnectPlugin(t.app));
      t.a.view.switchToTab.mockImplementation(async (tabId: string) => {
        const tab = t.a.tabMeta.getState().tabs.find((entry) => entry.id === tabId);
        t.a.tabMeta.set({ activeTabId: tabId });
        t.a.scene.set({ mapPath: tab?.filePath ?? null, isMapLoading: true } as never);
      });
      return { ...t, extension, finish: () => t.a.scene.set({ isMapLoading: false } as never) };
    }

    it("answers true once the tab's map is loaded, and not before", async () => {
      const t = loading();
      let answer: boolean | null = null;
      void t.extension.views.showTab!('view-a', 't2').then((value) => { answer = value; });
      await vi.advanceTimersByTimeAsync(10);
      expect(answer).toBeNull();
      expect(t.a.tabMeta.getState().activeTabId).toBe('t2');
      expect(t.extension.views.snapshot('view-a')?.tabId).toBeNull();
      t.finish();
      await vi.advanceTimersByTimeAsync(0);
      expect(answer).toBe(true);
      expect(t.extension.views.snapshot('view-a')?.tabId).toBe('t2');
    });

    it('answers true at once for a tab already shown, and false for an unknown view or tab', async () => {
      const { app, atlas } = setup();
      const extension = stockAtlasApi(app, atlas).connect(fakeConnectPlugin(app));
      await expect(extension.views.showTab!('view-a', 't1')).resolves.toBe(true);
      await expect(extension.views.showTab!('view-a', 'nope')).resolves.toBe(false);
      await expect(extension.views.showTab!('nope', 't1')).resolves.toBe(false);
      await expect(extension.views.showTab!('view-a', 5 as never)).resolves.toBe(false);
    });

    it('answers false when another switch overtakes it, when the GM clicks elsewhere, and after a minute', async () => {
      const t = loading();
      const first = t.extension.views.showTab!('view-a', 't2');
      await vi.advanceTimersByTimeAsync(10);
      const second = t.extension.views.showTab!('view-a', 't1');
      await vi.advanceTimersByTimeAsync(10);
      await expect(first).resolves.toBe(false);
      t.finish();
      await vi.advanceTimersByTimeAsync(0);
      await expect(second).resolves.toBe(true);

      const clicked = loading();
      const waiting = clicked.extension.views.showTab!('view-a', 't2');
      await vi.advanceTimersByTimeAsync(10);
      clicked.a.tabMeta.set({ activeTabId: 't1' });
      await expect(waiting).resolves.toBe(false);

      const slow = loading();
      const never = slow.extension.views.showTab!('view-a', 't2');
      await vi.advanceTimersByTimeAsync(60_001);
      await expect(never).resolves.toBe(false);
      expect(vi.getTimerCount()).toBeLessThan(5);
    });

    it('ends the wait when Connect unloads, leaving no timer behind', async () => {
      const t = loading();
      const plugin = fakeConnectPlugin(t.app);
      const extension = stockAtlasApi(t.app, t.atlas).connect(plugin);
      t.a.view.switchToTab.mockImplementation(async () => { t.a.scene.set({ isMapLoading: true } as never); });
      const waiting = extension.views.showTab!('view-a', 't2');
      await vi.advanceTimersByTimeAsync(10);
      (plugin as unknown as { unload(): void }).unload();
      await expect(waiting).resolves.toBe(false);
    });
  });
});
