import { describe, expect, it, vi } from 'vitest';
import type { AtlasExtension } from '@atlas-vtt/api-types';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';
import type { FakeUi, SlotCounts } from './fakeUi';

const NONE: SlotCounts = { toolbar: 0, palette: 0, dashboard: 0, viewMenu: 0, tokenMenu: 0, panel: 0 };
const noop = (): void => undefined;

type PanelHandle = ReturnType<AtlasExtension['ui']['addPanel']>;

function setup(): { atlas: FakeAtlas; ui: FakeUi; ext: AtlasExtension; plugin: ReturnType<typeof connectingPlugin> } {
  const atlas = new FakeAtlas({ capabilities: ['views', 'ui'] });
  atlas.views.open('v1');
  atlas.views.setActive('v1');
  const plugin = connectingPlugin('ext');
  return { atlas, ui: atlas.ui!, ext: atlas.connect(plugin), plugin };
}

function registerOneOfEach(ext: AtlasExtension): PanelHandle {
  ext.ui.addToolbarItem({ id: 't', icon: 'network', label: 'T', onClick: noop });
  ext.ui.addPaletteSection({ id: 'p', title: 'P', commands: () => [] });
  ext.ui.addDashboardTile({ id: 'd', icon: 'users', title: 'D', description: '', onClick: noop });
  ext.ui.addViewMenuItems(() => []);
  ext.ui.addTokenMenuItems(() => []);
  return ext.ui.addPanel({ id: 'panel', title: 'Panel', mount: () => noop });
}

describe('FakeAtlas follows the ui contract cases', () => {
  it('C-ui-1: everything an extension registers is gone when it unloads', () => {
    const { ui, ext, plugin } = setup();
    const panel = registerOneOfEach(ext);
    expect(ui.counts()).toEqual({ toolbar: 1, palette: 1, dashboard: 1, viewMenu: 1, tokenMenu: 1, panel: 1 });
    plugin.unload();
    expect(ui.counts()).toEqual(NONE);
    expect(() => panel.dispose()).not.toThrow();
  });

  it('C-ui-2: Atlas unloading removes every extension slot', () => {
    const { atlas, ui, ext } = setup();
    registerOneOfEach(ext);
    atlas.unload();
    expect(ui.counts()).toEqual(NONE);
  });

  it('C-ui-3: invalidate bumps the slots version', () => {
    const { ui, ext } = setup();
    const before = ui.version();
    ext.ui.invalidate();
    expect(ui.version()).toBeGreaterThan(before);
  });

  it('has no ui without the capability', () => {
    const atlas = new FakeAtlas({ capabilities: ['views'] });
    expect(atlas.ui).toBeUndefined();
    expect((atlas.connect(connectingPlugin('x')) as { ui?: unknown }).ui).toBeUndefined();
  });

  it('connecting again with the same id removes what the first connection registered', () => {
    const { atlas, ui, ext, plugin } = setup();
    ext.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: noop });
    const second = atlas.connect(plugin).ui;
    expect(ui.counts().toolbar).toBe(0);
    expect(() => second.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: noop })).not.toThrow();
  });

  it('refuses a malformed registration with an error naming the call and the field', () => {
    const { ui, ext } = setup();
    expect(() => ext.ui.addToolbarItem(undefined as never)).toThrow(/addToolbarItem needs an object/);
    expect(() => ext.ui.addToolbarItem({ id: '', icon: 'x', label: 'T', onClick: noop })).toThrow(/"id" must be a non-empty string/);
    expect(() => ext.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T' } as never)).toThrow(/"onClick" must be a function/);
    expect(() => ext.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: noop, views: ['sideways'] as never })).toThrow(/"views"/);
    expect(() => ext.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: noop, priority: Number.NaN })).toThrow(/"priority" must be a number/);
    expect(() => ext.ui.addPaletteSection({ id: 'p', title: 'P' } as never)).toThrow(/"commands" must be a function/);
    expect(() => ext.ui.addDashboardTile({ id: 'd', icon: 'x', title: 'D', onClick: noop } as never)).toThrow(/"description" must be a string/);
    expect(() => ext.ui.addViewMenuItems('x' as never)).toThrow(/needs a function/);
    expect(() => ext.ui.addTokenMenuItems(undefined as never)).toThrow(/needs a function/);
    expect(() => ext.ui.addPanel({ id: 'p', title: 'P' } as never)).toThrow(/"mount" must be a function/);
    expect(ui.counts()).toEqual(NONE);
  });

  it('refuses a second item with the same id from one extension, but not from another', () => {
    const { atlas, ext } = setup();
    const item = { id: 't', icon: 'x', label: 'T', onClick: noop };
    ext.ui.addToolbarItem(item);
    expect(() => ext.ui.addToolbarItem(item)).toThrow(/already registered/);
    expect(() => atlas.connect(connectingPlugin('other')).ui.addToolbarItem(item)).not.toThrow();
  });

  it('removes one registration with its disposer, however often it is called', () => {
    const { ui, ext } = setup();
    const remove = ext.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: noop });
    ext.ui.addDashboardTile({ id: 'd', icon: 'x', title: 'D', description: '', onClick: noop });
    remove();
    remove();
    expect(ui.counts()).toMatchObject({ toolbar: 0, dashboard: 1 });
  });

  it('keeps its own frozen copy of what it was given', () => {
    const { ui, ext } = setup();
    const item = { id: 't', icon: 'x', label: 'T', onClick: noop, views: ['map'] as Array<'map' | 'remote'> };
    ext.ui.addToolbarItem(item);
    item.label = 'Changed';
    item.views.push('remote');
    expect(ui.drawToolbar('v1').map((drawn) => drawn.label)).toEqual(['T']);
    expect(Object.isFrozen(ext.ui)).toBe(true);
  });

  it('draws the toolbar with isActive and badge read now, and skips player views', () => {
    const { atlas, ui, ext } = setup();
    let on = false;
    ext.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', priority: 60, onClick: noop, isActive: () => on, badge: () => (on ? 3 : null) });
    expect(ui.drawToolbar('v1')).toEqual([{ id: 't', icon: 'x', label: 'T', priority: 60, active: false, badge: null }]);
    on = true;
    expect(ui.drawToolbar('v1')[0]).toMatchObject({ active: true, badge: 3 });
    // a player window is not one of Atlas's listed map views: no slot draws in it
    expect(ui.drawToolbar('player')).toEqual([]);
  });

  it('a provider or callback that throws is skipped, not fatal', () => {
    const { ui, ext } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(noop);
    ext.ui.addViewMenuItems(() => { throw new Error('boom'); });
    ext.ui.addViewMenuItems(() => [{ label: 'Fine' }]);
    expect(ui.viewMenu('v1')).toEqual([{ label: 'Fine' }]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('FakeAtlas panels', () => {
  function withPanel(): ReturnType<typeof setup> & { handle: PanelHandle; unmounted: ReturnType<typeof vi.fn> } {
    const base = setup();
    const unmounted = vi.fn();
    const handle = base.ext.ui.addPanel({ id: 'p', title: 'P', mount: (container) => { container.textContent = 'mounted'; return unmounted; } });
    return { ...base, handle, unmounted };
  }

  it('opens, toggles and closes in the active map view or the view named, mounting into a container', () => {
    const { ui, handle, unmounted } = withPanel();
    expect(handle.isOpen()).toBe(false);
    handle.open();
    expect(handle.isOpen('v1')).toBe(true);
    expect(ui.panelContainer('p', 'v1')?.textContent).toBe('mounted');
    handle.toggle();
    expect(handle.isOpen()).toBe(false);
    expect(unmounted).toHaveBeenCalledOnce();
    handle.open('v1');
    handle.close();
    expect(handle.isOpen('v1')).toBe(false);
  });

  it('does nothing for a view that is not open, or when no map view is active', () => {
    const { atlas, ui, handle } = withPanel();
    handle.open('nope');
    expect(ui.panelContainer('p', 'nope')).toBeNull();
    atlas.views.setActive(null);
    handle.open();
    expect(handle.isOpen('v1')).toBe(false);
  });

  it('close() closes every view, close(viewId) only that one, and a closing view closes its panel', () => {
    const { atlas, handle, unmounted } = withPanel();
    atlas.views.open('v2');
    handle.open('v1');
    handle.open('v2');
    handle.close('v2');
    expect([handle.isOpen('v1'), handle.isOpen('v2')]).toEqual([true, false]);
    handle.open('v2');
    atlas.views.close('v2');
    expect(unmounted).toHaveBeenCalledTimes(2);
    handle.close();
    expect(handle.isOpen('v1')).toBe(false);
    expect(unmounted).toHaveBeenCalledTimes(3);
  });

  it('dispose closes the panel in every view and removes it; calling it again does nothing', () => {
    const { ui, handle, unmounted } = withPanel();
    handle.open('v1');
    handle.dispose();
    handle.dispose();
    expect(unmounted).toHaveBeenCalledOnce();
    expect(ui.counts().panel).toBe(0);
    handle.open('v1');
    expect(ui.panelContainer('p', 'v1')).toBeNull();
  });

  it('unloading the extension unmounts an open panel', () => {
    const { plugin, handle, unmounted } = withPanel();
    handle.open('v1');
    plugin.unload();
    expect(unmounted).toHaveBeenCalledOnce();
  });
});

describe('FakeAtlas draws slots as Atlas does', () => {
  it('accepts a blank but non-empty text, as Atlas does', () => {
    const { ext } = setup();
    expect(() => ext.ui.addToolbarItem({ id: ' ', icon: 'x', label: ' ', onClick: noop })).not.toThrow();
  });

  it('draws nothing in a player window, which is not one of the listed map views', () => {
    const { ui, ext } = setup();
    ext.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: noop });
    ext.ui.addPaletteSection({ id: 'p', title: 'P', commands: () => [{ id: 'c', icon: 'x', label: 'C', run: noop }] });
    ext.ui.addViewMenuItems(() => [{ label: 'Item' }]);
    ext.ui.addTokenMenuItems(() => [{ label: 'Item' }]);
    expect([ui.drawToolbar('player'), ui.palette('player'), ui.viewMenu('player'), ui.tokenMenu('player', 't', 'token')]).toEqual([[], [], [], []]);
    expect(ui.drawToolbar('v1')).toHaveLength(1);
  });

  it('closes a panel whose mount throws', () => {
    const { ui, ext } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(noop);
    const handle = ext.ui.addPanel({ id: 'p', title: 'P', mount: () => { throw new Error('boom'); } });
    handle.open('v1');
    expect(handle.isOpen('v1')).toBe(false);
    expect(ui.panelContainer('p', 'v1')).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('draws checked and disabled as booleans, as Atlas does', () => {
    const { ui, ext } = setup();
    ext.ui.addViewMenuItems(() => [{ label: 'Odd', checked: 'yes', disabled: 1 }, { label: 'Plain' }] as never);
    expect(ui.viewMenu('v1')).toEqual([{ label: 'Odd', checked: false, disabled: false }, { label: 'Plain' }]);
  });

  it('normalises menu entries, commands and badges', () => {
    const { ui, ext } = setup();
    ext.ui.addViewMenuItems(() => [
      { label: '' }, { label: 'Plain', checked: true, disabled: true },
      { label: 'Empty', submenu: [] },
      { label: 'Group', submenu: [{ label: '' }, { label: 'Child' }], checked: true },
    ] as never);
    expect(ui.viewMenu('v1')).toEqual([
      { label: 'Plain', checked: true, disabled: true },
      { label: 'Group', submenu: [{ label: 'Child' }] },
    ]);
    ext.ui.addPaletteSection({ id: 'full', title: 'Full', commands: () => [{ id: 'bad' } as never, { id: 'ok', icon: 'x', label: 'Ok', run: noop }] });
    ext.ui.addPaletteSection({ id: 'empty', title: 'Empty', commands: () => [] });
    expect(ui.palette('v1').map((section) => [section.id, section.commands.map((command) => command.id)])).toEqual([['full', ['ok']]]);
    let badge: unknown = 0;
    ext.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: noop, badge: () => badge as never });
    const drawn = (): unknown => ui.drawToolbar('v1')[0]!.badge;
    expect(drawn()).toBe(0);
    for (const nothing of ['', null, Number.NaN, {}, false]) {
      badge = nothing;
      expect(drawn()).toBeNull();
    }
    badge = true;
    expect(drawn()).toBe(true);
  });
});
