import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plugin } from 'obsidian';
import { AtlasLink, LAYOUT_READY_FALLBACK_MS, STOCK_GRACE_MS } from '../../../src/connect/atlasLink';
import { canShimStockAtlas, stockAtlasApi } from '../../../src/connect/stockAtlas';
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

  it('offers what hosting needs, lighting, the floating ui, tokens and dice, but no lasers', () => {
    const { app, atlas } = setup();
    const api = stockAtlasApi(app, atlas);
    expect(api.has('views') && api.has('presentation') && api.has('rules') && api.has('settings') && api.has('storage')).toBe(true);
    expect(api.has('lighting')).toBe(true);
    expect(api.has('ui')).toBe(true);
    expect(api.has('dice')).toBe(true);
    expect(api.has('lasers')).toBe(false);
    expect(api.has('scene-tabs')).toBe(false);
    expect(api.has('tokens')).toBe(true);
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
    expect(extension.settings.get('playerView')).toEqual({ showGrid: true, showTokenNameplates: false, showWidgets: false, showInitiative: false });
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
});
