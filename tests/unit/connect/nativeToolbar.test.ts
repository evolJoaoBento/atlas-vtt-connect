import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiApi } from '@atlas-vtt/api-types';
import type { DockEnv, DockView } from '../../../src/connect/stockUi/floatingDock';
import { NativeToolbar } from '../../../src/connect/stockUi/nativeToolbar';
import { createUiRegistry } from '../../../src/connect/stockUi/uiRegistry';

/** The part of Atlas's map view that matters here: its root, with the toolbar as Atlas draws it. */
function atlasView(options: { toolbar?: boolean } = {}) {
  const root = document.createElement('div');
  root.className = 'workspace-leaf-content atlas-vtt-plugin atlas-vtt-view';
  document.body.appendChild(root);
  const drawToolbar = (): HTMLElement => {
    const bar = document.createElement('div');
    bar.className = 'atlas-vtt-toolbar atlas-main-toolbar';
    bar.innerHTML = '<div class="atlas-toolbar-item" data-toolbar-item="move"></div><div class="atlas-toolbar-end"><div class="atlas-toggle" role="switch"></div></div>';
    root.appendChild(bar);
    return bar;
  };
  let bar = options.toolbar === false ? null : drawToolbar();
  return {
    root,
    bar: () => bar,
    /** Atlas draws its toolbar anew (React replaces the slot). */
    redraw: () => { bar?.remove(); bar = drawToolbar(); },
    end: () => root.querySelector<HTMLElement>('.atlas-toolbar-end'),
  };
}

function setup(options: { selected?: Array<{ id: string; kind: 'token' | 'character'; label: string }>; toolbar?: boolean } = {}) {
  const atlas = atlasView(options);
  const view: DockView = {
    viewId: 'v1', doc: document, root: atlas.root,
    selectedTokens: () => options.selected ?? [],
    tabs: () => [{ tabId: 't1', mapPath: 'a', name: 'One', active: true, presented: false }, { tabId: 't2', mapPath: 'b', name: 'Two', active: false, presented: true }],
  };
  const views = new Map<string, DockView>([['v1', view]]);
  const env: DockEnv = {
    activeView: () => views.get('v1') ?? null,
    view: (id) => views.get(id) ?? null,
    views: () => [...views.values()],
    watch: () => () => undefined,
    menu: () => { throw new Error('the native toolbar draws its own menus'); },
    setIcon: (element, name) => {
      element.replaceChildren();
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('data-icon', name);
      element.appendChild(svg);
    },
    memory: { get: () => undefined, set: () => undefined },
  };
  const coverage: string[] = [];
  const host: { current: NativeToolbar | null } = { current: null };
  const registry = createUiRegistry(() => host.current as never, () => host.current?.sync());
  const native = new NativeToolbar(registry.records, env, () => coverage.push('changed'));
  host.current = native;
  native.sync();
  const buttons = (): HTMLElement[] => [...atlas.root.querySelectorAll<HTMLElement>('.atlas-connect-group button')].filter((button) => !button.closest('.atlas-connect-tray, .atlas-connect-menu'));
  return {
    ...atlas, ui: registry.api as UiApi, native, registry, coverage, views, view, buttons,
    labels: () => buttons().map((button) => button.getAttribute('aria-label')),
  };
}

describe('Connect in Atlas\'s own toolbar', () => {
  beforeEach(() => { document.body.replaceChildren(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("puts a group of Atlas's own tool buttons in the toolbar's end slot, before its switch", () => {
    const t = setup();
    const stop = t.ui.addToolbarItem({ id: 'online', icon: 'network', label: 'Online session', priority: 60, onClick: () => undefined });
    t.ui.addToolbarItem({ id: 'low', icon: 'dice', label: 'Low', priority: 10, onClick: () => undefined });
    const end = t.end()!;
    expect(end.firstElementChild?.classList.contains('atlas-connect-group')).toBe(true);
    expect(end.lastElementChild?.classList.contains('atlas-toggle')).toBe(true);
    expect(t.labels()).toEqual(['Online session', 'Low']);
    const first = t.buttons()[0]!;
    // Atlas's markup: item > content > tool button > span > button with the icon first and a hidden label.
    expect(first.closest('.atlas-toolbar-item')?.querySelector('.atlas-toolbar-item__content .atlas-tool-button > span > button.btn.btn--toolbar.btn--icon')).toBe(first);
    expect(first.firstElementChild?.getAttribute('data-icon')).toBe('network');
    expect(first.querySelector('.sr-only')?.textContent).toBe('Online session');
    // The bar measures its own items only: ours is not a direct child with a toolbar item id.
    expect(t.bar()!.querySelectorAll(':scope > [data-toolbar-item]')).toHaveLength(1);
    stop();
    expect(t.labels()).toEqual(['Low']);
    expect(t.native.handles('v1')).toBe(true);
  });

  it('shows active state and badges, runs onClick with its view, and one that throws harms nothing', () => {
    const t = setup();
    const clicked: string[] = [];
    let active = false;
    t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'A', isActive: () => active, badge: () => 3, onClick: (ctx) => clicked.push(`${ctx.viewId}:${ctx.kind}`) });
    t.ui.addToolbarItem({ id: 'b', icon: 'x', label: 'B', priority: 1, badge: () => true, onClick: () => { throw new Error('boom'); } });
    t.ui.addToolbarItem({ id: 'c', icon: 'x', label: 'Hidden', isVisible: () => false, onClick: () => undefined });
    t.ui.addToolbarItem({ id: 'd', icon: 'x', label: 'Remote only', views: ['remote'], onClick: () => undefined });
    expect(t.labels()).toEqual(['A', 'B']);
    expect(t.buttons()[0]!.querySelector('.atlas-connect-badge')?.textContent).toBe('3');
    expect(t.buttons()[1]!.querySelector('.atlas-connect-dot')).not.toBeNull();
    expect(t.buttons()[0]!.classList.contains('is-active')).toBe(false);
    active = true;
    t.ui.invalidate();
    expect(t.buttons()[0]!.classList.contains('is-active')).toBe(true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    t.buttons()[0]!.click();
    t.buttons()[1]!.click();
    expect(clicked).toEqual(['v1:map']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    // The same buttons stay: pressing one does not rebuild the group.
    expect(t.buttons()).toHaveLength(2);
  });

  it('puts the group back when Atlas draws its toolbar anew, and lets go of panels that went with it', async () => {
    const t = setup();
    const unmounted: string[] = [];
    const panel = t.ui.addPanel({ id: 'p', title: 'Panel', mount: () => () => unmounted.push('p') });
    t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'A', onClick: () => undefined });
    panel.open('v1');
    expect(panel.isOpen('v1')).toBe(true);
    t.redraw();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.root.querySelectorAll('.atlas-connect-group')).toHaveLength(1);
    expect(t.end()!.firstElementChild?.classList.contains('atlas-connect-group')).toBe(true);
    expect(t.labels()).toEqual(['A']);
    expect(unmounted).toEqual(['p']);
    expect(panel.isOpen('v1')).toBe(false);
  });

  it('is not in a view whose toolbar it cannot find, and comes when the toolbar does (the floating dock stands in meanwhile)', async () => {
    const t = setup({ toolbar: false });
    t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'A', onClick: () => undefined });
    expect(t.native.handles('v1')).toBe(false);
    expect(t.root.querySelector('.atlas-connect-group')).toBeNull();
    t.redraw();
    await vi.advanceTimersByTimeAsync(1600);
    expect(t.native.handles('v1')).toBe(true);
    expect(t.coverage.length).toBeGreaterThan(0);
  });

  describe('panels', () => {
    it("rise over the group as Atlas's dice tray does, mount into it, and unmount when closed", () => {
      const t = setup();
      const log: string[] = [];
      const handle = t.ui.addPanel({ id: 'online', title: 'Online session', mount: (container, ctx) => { log.push(`mount:${ctx.viewId}`); container.textContent = 'hello'; return () => log.push('unmount'); } });
      t.ui.addToolbarItem({ id: 't', icon: 'x', label: 'Online', isActive: (ctx) => handle.isOpen(ctx.viewId), onClick: (ctx) => handle.toggle(ctx.viewId) });
      t.buttons()[0]!.click();
      vi.advanceTimersByTime(1);
      const tray = t.root.querySelector('.atlas-dice-tray.atlas-connect-tray')!;
      expect(tray.parentElement?.classList.contains('atlas-connect-group')).toBe(true);
      expect(tray.querySelector('.atlas-dice-panel')).not.toBeNull();
      expect(tray.querySelector('.atlas-connect-tray__title')?.textContent).toBe('Online session');
      expect(tray.querySelector('.atlas-connect-tray__content')?.textContent).toBe('hello');
      expect(log).toEqual(['mount:v1']);
      expect(t.buttons()[0]!.classList.contains('is-active')).toBe(true);
      // Pressing a button redraws the group but not the panel.
      t.ui.invalidate();
      expect(t.root.querySelectorAll('.atlas-connect-tray')).toHaveLength(1);
      expect(log).toEqual(['mount:v1']);
      t.buttons()[0]!.click();
      vi.advanceTimersByTime(1);
      expect(t.root.querySelector('.atlas-connect-tray')).toBeNull();
      expect(log).toEqual(['mount:v1', 'unmount']);
      expect(t.buttons()[0]!.classList.contains('is-active')).toBe(false);
    });

    it('are not taken out and put back when the group is drawn again, which would replay their slide-up as a flash', async () => {
      const t = setup();
      const handle = t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => undefined });
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'A', onClick: () => undefined });
      handle.open('v1');
      const tray = t.root.querySelector('.atlas-connect-tray')!;
      const moves: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) if (node === tray) moves.push('removed');
          for (const node of record.addedNodes) if (node === tray) moves.push('added');
        }
      });
      observer.observe(t.root, { childList: true, subtree: true });
      // What an outside click sets going: the views change, the group is drawn again, with and without a menu.
      t.native.sync();
      t.ui.invalidate();
      t.native.sync();
      t.ui.addViewMenuItems(() => [{ label: 'One', onClick: () => undefined }]);
      t.buttons().find((button) => button.getAttribute('aria-label') === 'More options')!.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      t.native.sync();
      await vi.advanceTimersByTimeAsync(10);
      expect(moves).toEqual([]);
      expect(t.root.querySelector('.atlas-connect-tray')).toBe(tray);
      observer.disconnect();
    });

    it('close on a press outside the group, and not on a press in them or on their buttons', () => {
      const t = setup();
      const unmounted: string[] = [];
      const handle = t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => unmounted.push('x') });
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'A', onClick: () => undefined });
      handle.open('v1');
      t.root.querySelector('.atlas-connect-tray__content')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      t.buttons()[0]!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      expect(handle.isOpen('v1')).toBe(true);
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      expect(handle.isOpen('v1')).toBe(false);
      expect(unmounted).toEqual(['x']);
      expect(t.root.querySelector('.atlas-connect-tray')).toBeNull();
      // Pressing outside once the panel is gone does nothing, and leaves no listener behind.
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      expect(unmounted).toEqual(['x']);
    });

    it('close from their own button, once in a view, and a mount that throws is not fatal', () => {
      const t = setup();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const handle = t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => undefined });
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'A', onClick: () => undefined });
      handle.open('v1');
      handle.open('v1');
      expect(t.root.querySelectorAll('.atlas-connect-tray')).toHaveLength(1);
      t.root.querySelector<HTMLElement>('.atlas-connect-tray button[aria-label="Close P"]')!.click();
      expect(handle.isOpen('v1')).toBe(false);
      handle.open('nope');
      expect(handle.isOpen('nope')).toBe(false);
      const bad = t.ui.addPanel({ id: 'bad', title: 'Bad', mount: () => { throw new Error('mount'); } });
      expect(() => bad.open('v1')).not.toThrow();
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    it("are kept inside the window the way Atlas's own panels are", () => {
      const t = setup();
      const handle = t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => undefined });
      t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'A', onClick: () => undefined });
      const rect = (left: number, right: number): DOMRect => ({ left, right, width: right - left, top: 0, bottom: 10, height: 10, x: left, y: 0, toJSON: () => ({}) });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect(window.innerWidth - 100, window.innerWidth + 200));
      handle.open('v1');
      const tray = t.root.querySelector<HTMLElement>('.atlas-connect-tray')!;
      // 200 px past the right edge, and a margin of 8: pulled back by 208.
      expect(tray.style.getPropertyValue('--atlas-keep-in-view-x')).toBe('-208px');
    });
  });

  describe('dropdowns', () => {
    it("open in Atlas's dropdown style, run the item chosen and close, and close on an outside press or Escape", () => {
      const t = setup();
      const ran: string[] = [];
      t.ui.addViewMenuItems(() => [{ label: 'Start', icon: 'play', onClick: () => ran.push('start') }, { label: 'Tick', checked: true, onClick: () => undefined }]);
      t.ui.addPaletteSection({ id: 's', title: 'Online play', commands: () => [{ id: 'c', icon: 'play', label: 'Start', run: () => ran.push('palette') }, { id: 'd', icon: 'x', label: 'Stop', run: () => ran.push('stop') }] });
      t.buttons().find((button) => button.getAttribute('aria-label') === 'More options')!.click();
      const menu = t.root.querySelector('.atlas-dropdown-content.atlas-dropdown-content--top.atlas-connect-menu')!;
      expect(menu).not.toBeNull();
      expect([...menu.querySelectorAll('.atlas-dropdown-menu-item')].map((item) => item.textContent)).toEqual(['Start', 'Tick', 'Stop']);
      expect(menu.querySelector('.atlas-connect-menu__heading')?.textContent).toBe('Online play');
      expect(menu.querySelectorAll('.atlas-dropdown-section').length).toBeGreaterThan(1);
      expect(menu.querySelectorAll('.atlas-dropdown-menu-item__check svg')).toHaveLength(1);
      (menu.querySelectorAll<HTMLElement>('.atlas-dropdown-menu-item')[0]!).click();
      expect(ran).toEqual(['start']);
      expect(t.root.querySelector('.atlas-connect-menu')).toBeNull();
      t.buttons().find((button) => button.getAttribute('aria-label') === 'More options')!.click();
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      expect(t.root.querySelector('.atlas-connect-menu')).toBeNull();
      t.buttons().find((button) => button.getAttribute('aria-label') === 'More options')!.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(t.root.querySelector('.atlas-connect-menu')).toBeNull();
    });

    it('stay open for an item that keeps it open, with what is read now, and expand submenus in place', () => {
      const t = setup();
      let ticked = false;
      t.ui.addViewMenuItems(() => [
        { label: 'Tick', checked: ticked, keepOpen: true, onClick: () => { ticked = !ticked; } },
        { label: 'Parent', submenu: [{ label: 'Child', onClick: () => undefined }] },
      ]);
      t.buttons().find((button) => button.getAttribute('aria-label') === 'More options')!.click();
      const first = t.root.querySelectorAll<HTMLElement>('.atlas-dropdown-menu-item')[0]!;
      first.click();
      expect(t.root.querySelector('.atlas-connect-menu')).not.toBeNull();
      expect(t.root.querySelector('.atlas-dropdown-menu-item__check svg')).not.toBeNull();
      const sub = t.root.querySelector<HTMLElement>('.atlas-connect-menu__sub')!;
      expect(sub.hidden).toBe(true);
      [...t.root.querySelectorAll<HTMLElement>('.atlas-dropdown-menu-item')].find((item) => item.textContent === 'Parent')!.click();
      expect(sub.hidden).toBe(false);
    });

    it('put an open panel out of the way while they show, and bring it back', () => {
      const t = setup();
      const unmounted: string[] = [];
      t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => unmounted.push('x') }).open('v1');
      t.ui.addViewMenuItems(() => [{ label: 'One', onClick: () => undefined }]);
      const tray = t.root.querySelector<HTMLElement>('.atlas-connect-tray')!;
      t.buttons().find((button) => button.getAttribute('aria-label') === 'More options')!.click();
      expect(tray.hidden).toBe(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(tray.hidden).toBe(false);
      expect(unmounted).toEqual([]);
    });

    it('offer the token menu for the selected tokens and the scene tab menu', () => {
      const t = setup({ selected: [{ id: 'k1', kind: 'character', label: 'Ana' }] });
      t.ui.addTokenMenuItems((ctx) => [{ label: `Controlled by ${ctx.tokenId}`, onClick: () => undefined }]);
      t.ui.addSceneTabMenuSection!({ heading: 'Present to', items: (ctx) => [{ label: `Show ${ctx.name}`, onClick: () => undefined }] });
      expect(t.labels()).toEqual(['Token: Ana', 'Scenes']);
      t.buttons()[0]!.click();
      expect(t.root.querySelector('.atlas-connect-menu')?.textContent).toContain('Controlled by k1');
      t.buttons()[1]!.click();
      expect(t.root.querySelectorAll('.atlas-connect-menu')).toHaveLength(1);
      const text = t.root.querySelector('.atlas-connect-menu')!.textContent!;
      expect(text).toContain('Two (presented)');
      expect(text).toContain('Show One');
    });
  });

  it('lets go of a view whose root left the page, and never loops over it', async () => {
    const t = setup();
    t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'A', onClick: () => undefined });
    expect(t.native.handles('v1')).toBe(true);
    t.root.remove();
    t.native.sync();
    expect(t.native.handles('v1')).toBe(false);
    // Still listed, but not on the page: nothing is put into it, however long it is left.
    const before = t.root.querySelectorAll('.atlas-connect-group').length;
    await vi.advanceTimersByTimeAsync(10_000);
    t.native.sync();
    expect(t.root.querySelectorAll('.atlas-connect-group').length).toBeLessThanOrEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows Atlas's own tooltip after a moment over a button, and takes it away", () => {
    const t = setup();
    t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'Online session', onClick: () => undefined });
    const button = t.buttons()[0]!;
    button.dispatchEvent(new MouseEvent('pointerenter'));
    expect(document.querySelector('.tooltip-content')).toBeNull();
    vi.advanceTimersByTime(300);
    expect(document.querySelector('.tooltip-content .tooltip-label')?.textContent).toBe('Online session');
    button.dispatchEvent(new MouseEvent('pointerleave'));
    expect(document.querySelector('.tooltip-content')).toBeNull();
  });

  it('puts the tooltip over its button, never in the page flow where it would push the layout under the pointer', () => {
    const t = setup();
    t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'Online session', onClick: () => undefined });
    const button = t.buttons()[0]!;
    const box = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === button) return box(700, 735, 40, 40);
      if (this.classList.contains('tooltip-content')) return box(0, 0, 100, 30);
      return box(0, 0, 0, 0);
    });
    button.dispatchEvent(new MouseEvent('pointerenter'));
    vi.advanceTimersByTime(300);
    const tip = document.querySelector<HTMLElement>('.tooltip-content')!;
    expect(tip.style.left).toBe('670px');
    expect(tip.style.top).toBe('697px');
    expect(tip.classList.contains('is-placed')).toBe(true);
    // Fixed and hidden from the moment it is in the page, so it is never a block in the body's flow.
    const css = readFileSync('src/connect/stockUi/stock-dock.scss', 'utf8');
    expect(css).toMatch(/\.tooltip-content\.atlas-connect-tip \{[^}]*position: fixed;[^}]*visibility: hidden;/);
    vi.restoreAllMocks();
  });

  it('leaves nothing behind when it stops', async () => {
    const t = setup();
    t.ui.addPanel({ id: 'p', title: 'P', mount: () => () => undefined }).open('v1');
    t.ui.addToolbarItem({ id: 'a', icon: 'x', label: 'A', onClick: () => undefined });
    t.buttons().find((button) => button.getAttribute('aria-label') === 'A')!.dispatchEvent(new MouseEvent('pointerenter'));
    t.native.stop();
    expect(t.root.querySelector('.atlas-connect-group')).toBeNull();
    expect(document.querySelector('.tooltip-content')).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
    expect(t.native.handles('v1')).toBe(false);
  });
});
