import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiApi } from '@atlas-vtt/api-types';
import { FloatingDock, type DockEnv, type DockView, type MenuItemLike, type MenuLike } from '../../../src/connect/stockUi/floatingDock';
import { createUiRegistry } from '../../../src/connect/stockUi/uiRegistry';

interface FakeEntry { title: string; icon: string | null; checked: boolean | null; disabled: boolean; click: (() => void) | null; submenu: FakeMenu | null }

class FakeMenu implements MenuLike {
  entries: FakeEntry[] = [];
  separators = 0;
  constructor(private readonly submenus: boolean, readonly shown: Array<{ menu: FakeMenu; at: { x: number; y: number } }> = []) {}
  addItem(callback: (item: MenuItemLike) => void): void {
    const entry: FakeEntry = { title: '', icon: null, checked: null, disabled: false, click: null, submenu: null };
    const item: MenuItemLike = {
      setTitle: (title) => { entry.title = title; return item; },
      setIcon: (icon) => { entry.icon = icon; return item; },
      setChecked: (checked) => { entry.checked = checked; return item; },
      setDisabled: (disabled) => { entry.disabled = disabled; return item; },
      onClick: (click) => { entry.click = click; return item; },
      ...(this.submenus && { setSubmenu: () => { entry.submenu = new FakeMenu(true, this.shown); return entry.submenu; } }),
    };
    this.entries.push(entry);
    callback(item);
  }
  addSeparator(): void { this.separators++; }
  showAtPosition(at: { x: number; y: number }): void { this.shown.push({ menu: this, at }); }
  titles(): string[] { return this.entries.map((entry) => entry.title); }
}

function setup(options: { submenus?: boolean; selected?: Array<{ id: string; kind: 'token' | 'character'; label: string }> } = {}) {
  const views = new Map<string, DockView>();
  const view: DockView = {
    viewId: 'v1', doc: document, root: null,
    selectedTokens: () => options.selected ?? [],
    tabs: () => [{ tabId: 't1', mapPath: 'a.atlasmap', name: 'One', active: true, presented: false }, { tabId: 't2', mapPath: 'b.atlasmap', name: 'Two', active: false, presented: true }],
  };
  views.set('v1', view);
  let active: DockView | null = view;
  let notify: () => void = () => undefined;
  const memory = new Map<string, unknown>();
  const shown: Array<{ menu: FakeMenu; at: { x: number; y: number } }> = [];
  const env: DockEnv = {
    activeView: () => active,
    view: (id) => views.get(id) ?? null,
    views: () => [...views.values()],
    watch: (listener) => { notify = listener; return () => { notify = () => undefined; }; },
    menu: () => new FakeMenu(options.submenus ?? true, shown),
    setIcon: (element, name) => { element.dataset.icon = name; },
    memory: { get: (key) => memory.get(key), set: (key, value) => { memory.set(key, value); } },
  };
  let dock: FloatingDock | null = null;
  const registry = createUiRegistry(() => dock, () => dock?.refresh());
  dock = new FloatingDock(registry.records, env);
  const stop = dock.start();
  return {
    ui: registry.api as UiApi, dock, stop, memory, shown, views, view, registry,
    setActive: (next: DockView | null) => { active = next; notify(); },
    root: () => document.querySelector<HTMLElement>('.atlas-connect-dock'),
    buttons: () => [...document.querySelectorAll<HTMLElement>('.atlas-connect-dock__button')],
    labels: () => [...document.querySelectorAll('.atlas-connect-dock__button')].map((button) => button.getAttribute('aria-label')),
  };
}

const pointer = (type: string, init: { x?: number; y?: number; id?: number } = {}): Event => {
  const event = new MouseEvent(type, { clientX: init.x ?? 0, clientY: init.y ?? 0, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: init.id ?? 1 });
  return event;
};

describe('the stock stand-in\'s ui namespace', () => {
  beforeEach(() => { document.body.replaceChildren(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('registry', () => {
    it('refuses what the API refuses, naming the call and the field, and a second item with the same id', () => {
      const { ui } = setup();
      expect(() => ui.addToolbarItem({ id: 'a', icon: '', label: 'x', onClick: () => undefined })).toThrow(/ui\.addToolbarItem: icon/);
      expect(() => ui.addToolbarItem({ id: 'a', icon: 'x', label: 'x' } as never)).toThrow(/onClick/);
      expect(() => ui.addToolbarItem({ id: '', icon: 'x', label: 'x', onClick: () => undefined })).toThrow(/id/);
      const stop = ui.addToolbarItem({ id: 'a', icon: 'x', label: 'x', onClick: () => undefined });
      expect(() => ui.addToolbarItem({ id: 'a', icon: 'x', label: 'y', onClick: () => undefined })).toThrow(/already registered/);
      stop();
      expect(() => ui.addToolbarItem({ id: 'a', icon: 'x', label: 'y', onClick: () => undefined })).not.toThrow();
      expect(() => ui.addPaletteSection({ id: 'p', title: 'T' } as never)).toThrow(/commands/);
      expect(() => ui.addViewMenuItems('no' as never)).toThrow(/provider/);
      expect(() => ui.addPanel({ id: 'p', title: 'T' } as never)).toThrow(/mount/);
      expect(() => ui.addSceneTabMenuSection!({ heading: ' ', items: () => [] })).toThrow(/heading/);
      expect(() => ui.addDashboardTile({ id: 'd', icon: 'x', title: 'T', description: 1 as never, onClick: () => undefined })).toThrow(/description/);
    });

    it('takes everything away when the extension is disposed', () => {
      const t = setup();
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'One', onClick: () => undefined });
      t.ui.addViewMenuItems(() => []);
      t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => undefined });
      t.registry.dispose();
      expect(t.registry.records.toolbar.size + t.registry.records.viewMenus.size + t.registry.records.panels.size).toBe(0);
      expect(t.root()).toBeNull();
    });
  });

  describe('dock', () => {
    it('shows only while a map view is open and something is registered', () => {
      const t = setup();
      expect(t.root()).toBeNull();
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'One', onClick: () => undefined });
      expect(t.root()).not.toBeNull();
      t.setActive(null);
      vi.advanceTimersByTime(0);
      expect(t.root()).toBeNull();
      t.setActive(t.view);
      expect(t.root()).not.toBeNull();
    });

    it('lists toolbar items with the higher priority first, reads isActive, badge and isVisible, and runs onClick with its view', () => {
      const t = setup();
      const clicked: string[] = [];
      let on = false;
      t.ui.addToolbarItem({ id: 'low', icon: 'a', label: 'Low', priority: 10, onClick: (ctx) => clicked.push(`low:${ctx.viewId}:${ctx.kind}:${String(ctx.isPlayerView)}`) });
      t.ui.addToolbarItem({ id: 'high', icon: 'b', label: 'High', priority: 90, isActive: () => on, badge: () => 3, onClick: () => clicked.push('high') });
      t.ui.addToolbarItem({ id: 'dot', icon: 'c', label: 'Dot', badge: () => true, onClick: () => undefined });
      t.ui.addToolbarItem({ id: 'hidden', icon: 'd', label: 'Hidden', isVisible: () => false, onClick: () => undefined });
      t.ui.addToolbarItem({ id: 'remote', icon: 'e', label: 'Remote only', views: ['remote'], onClick: () => undefined });
      t.ui.addToolbarItem({ id: 'throws', icon: 'f', label: 'Throws', isVisible: () => { throw new Error('x'); }, onClick: () => undefined });
      expect(t.labels()).toEqual(['High', 'Dot', 'Low']);
      expect(t.buttons()[0]!.classList.contains('is-active')).toBe(false);
      expect(t.buttons()[0]!.querySelector('.atlas-connect-dock__badge')?.textContent).toBe('3');
      expect(t.buttons()[1]!.querySelector('.atlas-connect-dock__dot')).not.toBeNull();
      on = true;
      t.ui.invalidate();
      expect(t.buttons()[0]!.classList.contains('is-active')).toBe(true);
      t.buttons()[2]!.click();
      t.buttons()[0]!.click();
      expect(clicked).toEqual(['low:v1:map:false', 'high']);
      expect(t.buttons()[0]!.dataset.icon).toBe('b');
    });

    it('does not let a throwing item take the dock down', () => {
      const t = setup();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'Bad', badge: () => { throw new Error('b'); }, isActive: () => { throw new Error('a'); }, onClick: () => { throw new Error('c'); } });
      t.buttons()[0]!.click();
      expect(t.root()).not.toBeNull();
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    it('collapses to its header and remembers it', () => {
      const t = setup();
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'One', onClick: () => undefined });
      t.root()!.querySelector<HTMLElement>('.atlas-connect-dock__collapse')!.click();
      expect(t.root()!.classList.contains('is-collapsed')).toBe(true);
      expect(t.memory.get('dock.collapsed')).toBe(true);
      t.root()!.querySelector<HTMLElement>('.atlas-connect-dock__collapse')!.click();
      expect(t.root()!.classList.contains('is-collapsed')).toBe(false);
    });

    it('drags by its grip, stays under the title bar, remembers where it was dropped and removes nothing else', () => {
      const t = setup();
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'One', onClick: () => undefined });
      const grip = t.root()!.querySelector<HTMLElement>('.atlas-connect-dock__grip')!;
      grip.dispatchEvent(pointer('pointerdown', { x: 0, y: 0 }));
      expect(grip.classList.contains('is-dragging')).toBe(true);
      grip.dispatchEvent(pointer('pointermove', { x: 300, y: 5 }));
      expect(t.root()!.style.left).toBe('300px');
      // Never above the 44 px of Obsidian's title bar.
      expect(t.root()!.style.top).toBe('44px');
      grip.dispatchEvent(pointer('pointermove', { x: 5000, y: 3000 }));
      expect(Number.parseInt(t.root()!.style.left, 10)).toBeLessThanOrEqual(window.innerWidth);
      grip.dispatchEvent(pointer('pointerup'));
      expect(grip.classList.contains('is-dragging')).toBe(false);
      expect(t.memory.get('dock.place')).toBeDefined();
      // Another pointer cannot move it.
      grip.dispatchEvent(pointer('pointermove', { x: 10, y: 100, id: 2 }));
      expect(t.root()!.style.left).not.toBe('10px');
    });

    it('comes back where it was left', () => {
      const first = setup();
      first.memory.set('dock.place', { x: 123, y: 321 });
      first.stop();
      document.body.replaceChildren();
      const again = setup();
      again.memory.set('dock.place', { x: 123, y: 321 });
      again.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'One', onClick: () => undefined });
      again.root()!.remove();
      again.dock.refresh();
      expect(again.root()!.style.left).toBe('123px');
      expect(again.root()!.style.top).toBe('321px');
    });

    it('leaves nothing on the page when it stops', () => {
      const t = setup();
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'One', onClick: () => undefined });
      t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => undefined }).open();
      t.stop();
      expect(document.body.children).toHaveLength(0);
    });
  });

  describe('menus', () => {
    it('has no More options menu: view menu items and palette sections are Obsidian commands too', () => {
      const t = setup();
      t.ui.addViewMenuItems(() => [{ label: 'Open', onClick: () => undefined }]);
      t.ui.addPaletteSection({ id: 's', title: 'Online', commands: () => [{ id: 'c', icon: 'play', label: 'Start', run: () => undefined }] });
      expect(t.root()).toBeNull();
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'One', onClick: () => undefined });
      expect(t.labels()).toEqual(['One']);
    });

    it('runs what is chosen, separated and headed as given', () => {
      const t = setup({ selected: [{ id: 'k1', kind: 'character', label: 'Ana' }] });
      const ran: string[] = [];
      t.ui.addTokenMenuItems(() => [{ label: 'Open', icon: 'radio', onClick: () => ran.push('open') }, { label: '-' }, { label: 'Online', disabled: true }, { label: 'Start', onClick: () => ran.push('start') }]);
      t.buttons().find((button) => button.dataset.icon === 'user')!.click();
      const menu = t.shown[0]!.menu;
      expect(menu.titles()).toEqual(['Open', 'Online', 'Start']);
      expect(menu.separators).toBe(1);
      expect(menu.entries[1]!.disabled).toBe(true);
      menu.entries[0]!.click!();
      menu.entries[2]!.click!();
      expect(ran).toEqual(['open', 'start']);
    });

    it('shows a menu again after an item that keeps it open, with what it reads now', () => {
      const t = setup({ selected: [{ id: 'k1', kind: 'character', label: 'Ana' }] });
      let ticked = false;
      t.ui.addTokenMenuItems(() => [{ label: 'Tick', checked: ticked, keepOpen: true, onClick: () => { ticked = !ticked; } }]);
      t.buttons().find((button) => button.dataset.icon === 'user')!.click();
      t.shown[0]!.menu.entries[0]!.click!();
      vi.advanceTimersByTime(1);
      expect(t.shown).toHaveLength(2);
      expect(t.shown[1]!.menu.entries[0]!.checked).toBe(true);
    });

    it("lists submenus in place under the parent's name where Obsidian has none", () => {
      const t = setup({ submenus: false, selected: [{ id: 'k1', kind: 'character', label: 'Ana' }] });
      t.ui.addTokenMenuItems(() => [{ label: 'Parent', submenu: [{ label: 'Child', onClick: () => undefined }] }]);
      t.buttons().find((button) => button.dataset.icon === 'user')!.click();
      expect(t.shown[0]!.menu.titles()).toEqual(['Parent', 'Parent › Child']);
    });

    it('offers the token menu for the selected tokens: flat for one, a submenu each for several', () => {
      const one = setup({ selected: [{ id: 'k1', kind: 'character', label: 'Ana' }] });
      one.ui.addTokenMenuItems((ctx) => (ctx.tokenKind === 'character' ? [{ label: `Controlled by ${ctx.tokenId}`, onClick: () => undefined }] : []));
      const button = one.buttons().find((entry) => entry.dataset.icon === 'user')!;
      expect(button.getAttribute('aria-label')).toBe('Token: Ana');
      button.click();
      expect(one.shown[0]!.menu.titles()).toEqual(['Controlled by k1']);

      document.body.replaceChildren();
      const many = setup({ selected: [{ id: 'k1', kind: 'character', label: 'Ana' }, { id: 'k2', kind: 'token', label: 'Orc' }] });
      many.ui.addTokenMenuItems((ctx) => (ctx.tokenKind === 'character' ? [{ label: 'Controlled by', onClick: () => undefined }] : []));
      many.buttons().find((entry) => entry.dataset.icon === 'user')!.click();
      expect(many.shown[0]!.menu.titles()).toEqual(['Ana (1)']);
      expect(many.shown[0]!.menu.entries[0]!.submenu!.titles()).toEqual(['Controlled by']);
    });

    it('has no token button without a selection, or when no provider offers anything', () => {
      const none = setup();
      none.ui.addTokenMenuItems(() => [{ label: 'x', onClick: () => undefined }]);
      expect(none.buttons().find((button) => button.dataset.icon === 'user')).toBeUndefined();
      document.body.replaceChildren();
      const empty = setup({ selected: [{ id: 'k', kind: 'token', label: 'Orc' }] });
      empty.ui.addTokenMenuItems(() => []);
      expect(empty.buttons().find((button) => button.dataset.icon === 'user')).toBeUndefined();
    });

    it('offers the scene tab menu sections for each tab', () => {
      const t = setup();
      t.ui.addSceneTabMenuSection!({ heading: 'Present to', items: (ctx) => (ctx.active ? [{ label: `Show ${ctx.name}`, onClick: () => undefined }] : []) });
      t.buttons().find((button) => button.dataset.icon === 'layout-list')!.click();
      const menu = t.shown[0]!.menu;
      expect(menu.titles()).toEqual(['One']);
      expect(menu.entries[0]!.submenu!.titles()).toEqual(['Present to', 'Show One']);
    });
  });

  describe('panels', () => {
    it('mounts into a draggable window for the view, tells the toolbar, and unmounts when closed', () => {
      const t = setup();
      const log: string[] = [];
      const handle = t.ui.addPanel({
        id: 'online', title: 'Online session',
        mount: (container, ctx) => {
          log.push(`mount:${ctx.viewId}:${ctx.kind}`);
          container.textContent = 'hello';
          return () => log.push('unmount');
        },
      });
      t.ui.addToolbarItem({ id: 't', icon: 'x', label: 'Online', isActive: (ctx) => handle.isOpen(ctx.viewId), onClick: (ctx) => handle.toggle(ctx.viewId) });
      expect(handle.isOpen()).toBe(false);
      t.buttons()[0]!.click();
      expect(log).toEqual(['mount:v1:map']);
      expect(handle.isOpen('v1')).toBe(true);
      expect(handle.isOpen()).toBe(true);
      expect(document.querySelector('.atlas-connect-window__content')?.textContent).toBe('hello');
      expect(document.querySelector('.atlas-connect-window__title')?.textContent).toBe('Online session');
      expect(t.buttons()[0]!.classList.contains('is-active')).toBe(true);
      // Opening it again brings it forward, not a second window.
      handle.open('v1');
      expect(document.querySelectorAll('.atlas-connect-window')).toHaveLength(1);
      const grip = document.querySelector<HTMLElement>('.atlas-connect-window__grip')!;
      grip.dispatchEvent(pointer('pointerdown'));
      grip.dispatchEvent(pointer('pointermove', { x: 200, y: 200 }));
      grip.dispatchEvent(pointer('pointerup'));
      expect(t.memory.get('panel.online')).toBeDefined();
      t.buttons()[0]!.click();
      expect(log).toEqual(['mount:v1:map', 'unmount']);
      expect(document.querySelector('.atlas-connect-window')).toBeNull();
      expect(t.buttons()[0]!.classList.contains('is-active')).toBe(false);
    });

    it('closes from its own button, with an unknown view doing nothing, and on dispose in every view', () => {
      const t = setup();
      const unmounted: string[] = [];
      const handle = t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => unmounted.push('x') });
      t.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: () => undefined });
      handle.open('nope');
      expect(handle.isOpen('nope')).toBe(false);
      handle.open();
      document.querySelector<HTMLElement>('.atlas-connect-window__close')!.click();
      expect(unmounted).toEqual(['x']);
      handle.open();
      handle.dispose();
      expect(unmounted).toEqual(['x', 'x']);
      expect(handle.isOpen()).toBe(false);
      handle.open();
      expect(document.querySelector('.atlas-connect-window')).toBeNull();
      expect(() => handle.dispose()).not.toThrow();
      expect(t.registry.records.panels.size).toBe(0);
    });

    it('closes the panel of a view that went, and survives a mount that throws', () => {
      const t = setup();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const handle = t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => undefined });
      t.ui.addToolbarItem({ id: 't', icon: 'x', label: 'T', onClick: () => undefined });
      handle.open('v1');
      t.views.delete('v1');
      t.dock.refresh();
      expect(document.querySelector('.atlas-connect-window')).toBeNull();
      t.views.set('v1', t.view);
      const bad = t.ui.addPanel({ id: 'bad', title: 'Bad', mount: () => { throw new Error('mount'); } });
      expect(() => bad.open('v1')).not.toThrow();
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });
  });
});
