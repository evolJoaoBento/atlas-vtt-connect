/**
 * Puts Connect into Atlas's own toolbar, so it looks like part of Atlas: a group of icon buttons at the end of the map
 * view's main toolbar (in the `.atlas-toolbar-end` slot, which the bar counts as fixed width, before the GM view
 * switch), with Atlas's own panel and dropdown styling for what they open. Atlas draws its toolbar with React, so this
 * reads its markup (`atlas-toolbar-item`, `atlas-tool-button`, `btn--toolbar`, `atlas-dice-tray`, `atlas-dropdown-*`)
 * and watches the view: whenever Atlas draws the slot anew, the group goes back in. A view whose toolbar cannot be found
 * is left to the floating dock (`floatingDock.ts`).
 *
 * Everything of Atlas's CSS is scoped to `.atlas-vtt-plugin`, the view's root, so what is added stays inside it.
 */
import type { Disposer, MenuItem, PanelSpec, SceneTabMenuContext, TokenMenuContext, ToolbarItemContext, ViewContext } from '@atlas-vtt/api-types';
import type { DockEnv, DockTab, DockToken, DockView } from './floatingDock';
import type { PanelHost, UiRecords } from './uiRegistry';
import type { EditTokenSectionSpec } from '../../app/online/gm-ui/editTokenSection';
import { watchTokenContextMenu } from './tokenContextMenu';

const END = '.atlas-main-toolbar > .atlas-toolbar-end';
const GROUP = 'atlas-connect-group';
const TIP_DELAY_MS = 300;
const EDGE = 8;

interface OpenPanel {
  tray: HTMLElement;
  content: HTMLElement;
  dispose: Disposer;
}

interface Bar {
  view: DockView;
  group: HTMLElement | null;
  /** Item elements by toolbar item id, and the three menu buttons by name. */
  items: Map<string, HTMLElement>;
  panels: Map<string, OpenPanel>;
  /** The open dropdown; `at` is set for one opened at the pointer (a scene tab's right-click), which is not in the group. */
  menu: { name: string; element: HTMLElement; stop: Disposer; at?: { x: number; y: number } } | null;
  /** The lists open in the menu, by their labels from the top: kept while it is redrawn after a choice. */
  openLists: Set<string>;
  observer: MutationObserver | null;
  stops: Disposer[];
}

/** The Atlas view a bar's buttons act on: its own, or for a Tabletop board the Atlas view holding its map. */
function actsOn(bar: Bar): string {
  return bar.view.contextViewId ?? bar.view.viewId;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  return createEl(tag, { cls, ...(text !== undefined && { text }) });
}

function guarded<T>(what: string, fallback: T, call: () => T): T {
  try {
    return call();
  } catch (error) {
    console.error(`[Atlas VTT Connect] ${what} failed:`, error);
    return fallback;
  }
}

/** Keeps `element` inside the window with the margin Atlas's own panels keep (`--atlas-keep-in-view-x`). */
function keepInView(element: HTMLElement): void {
  const win = element.ownerDocument.defaultView;
  if (!win) return;
  element.setCssProps({ '--atlas-keep-in-view-x': '0px' });
  const rect = element.getBoundingClientRect();
  if (rect.width === 0) return;
  const shift = rect.left < EDGE ? EDGE - rect.left : rect.right > win.innerWidth - EDGE ? win.innerWidth - EDGE - rect.right : 0;
  element.setCssProps({ '--atlas-keep-in-view-x': `${Math.round(shift)}px` });
}

/** Puts a menu opened at the pointer at `at`, kept inside the window. */
function placeAt(element: HTMLElement, at: { x: number; y: number }): void {
  const win = element.ownerDocument.defaultView;
  if (!win) return;
  const rect = element.getBoundingClientRect();
  const left = Math.max(EDGE, Math.min(at.x, win.innerWidth - rect.width - EDGE));
  const top = Math.max(EDGE, Math.min(at.y, win.innerHeight - rect.height - EDGE));
  element.setCssProps({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
}

export class NativeToolbar implements PanelHost {
  private readonly bars = new Map<string, Bar>();
  /** What each button does when pressed, kept by the button so the button itself is made once. */
  private readonly clicks = new WeakMap<HTMLElement, () => void>();
  private tip: HTMLElement | null = null;
  /** The bar whose button is being answered: a panel it opens goes there (a Tabletop board's, for its Atlas view). */
  private clickedBar: Bar | null = null;
  private tipTimer: number | null = null;

  constructor(
    private readonly records: UiRecords,
    private readonly env: DockEnv,
    /** Called when a view gains or loses its native toolbar group, so the floating dock can stand in or step back. */
    private readonly onCoverage: () => void,
  ) {}

  /** Whether Connect is in this view's own toolbar now. */
  handles(viewId: string): boolean {
    return this.bars.get(viewId)?.group?.isConnected === true;
  }

  /** Brings the toolbars of the open views in line with what is registered: injects, updates, and lets go of views that went. */
  sync(): void {
    const views = this.env.views();
    // A view that is gone, or whose root left the page, has no toolbar to be in: nothing to put back there.
    for (const [id, bar] of [...this.bars]) {
      if (!views.some((view) => view.viewId === id && view.root?.isConnected === true)) this.release(id, bar);
    }
    let changed = false;
    for (const view of views) {
      if (!view.root?.isConnected) continue;
      let bar = this.bars.get(view.viewId);
      if (!bar) {
        bar = { view, group: null, items: new Map(), panels: new Map(), menu: null, openLists: new Set(), observer: null, stops: [] };
        this.bars.set(view.viewId, bar);
        this.watch(bar);
      }
      bar.view = view;
      const had = bar.group?.isConnected === true;
      this.render(bar);
      if (had !== (bar.group?.isConnected === true)) changed = true;
    }
    if (changed) this.onCoverage();
  }

  stop(): void {
    for (const [id, bar] of [...this.bars]) this.release(id, bar);
    this.hideTip();
  }

  // ---- panels ---------------------------------------------------------------------------------------------------

  open(panelId: string, viewId: string | undefined): void {
    const bar = this.barFor(viewId);
    const spec = this.records.panels.get(panelId);
    if (!bar?.group || !spec) return;
    this.closeMenu(bar);
    if (bar.panels.has(panelId)) return;
    bar.panels.set(panelId, this.createPanel(bar, spec));
    this.render(bar);
  }

  close(panelId: string, viewId: string | undefined): void {
    if (viewId === undefined) {
      for (const bar of this.bars.values()) this.closePanel(bar, panelId);
    } else {
      const bar = this.bars.get(viewId);
      if (bar) this.closePanel(bar, panelId);
    }
  }

  isOpen(panelId: string, viewId: string | undefined): boolean {
    return this.barFor(viewId)?.panels.has(panelId) === true;
  }

  remove(panelId: string): void {
    for (const bar of this.bars.values()) this.closePanel(bar, panelId);
  }

  private barFor(viewId: string | undefined): Bar | undefined {
    const clicked = this.clickedBar;
    if (clicked?.group?.isConnected && (viewId === undefined || actsOn(clicked) === viewId)) return clicked;
    const id = viewId ?? this.env.activeView()?.viewId;
    return id === undefined ? undefined : this.bars.get(id);
  }

  private closePanel(bar: Bar, panelId: string): void {
    const open = bar.panels.get(panelId);
    if (!open) return;
    bar.panels.delete(panelId);
    guarded('A panel unmount', undefined, () => open.dispose());
    open.tray.remove();
    this.render(bar);
  }

  private createPanel(bar: Bar, spec: PanelSpec): OpenPanel {
    // Atlas's own panel shell: the tray that rises over its button and the panel it holds, as the dice tray is built.
    const tray = make('div', 'atlas-dice-tray atlas-connect-tray');
    const shell = make('div', 'atlas-dice-panel atlas-connect-tray__panel');
    const head = make('div', 'atlas-connect-tray__head');
    head.appendChild(make('span', 'atlas-connect-tray__title', spec.title));
    const close = make('button', 'btn btn--ghost btn--icon btn--sm');
    close.setAttribute('aria-label', `Close ${spec.title}`);
    this.env.setIcon(close, 'x');
    close.addEventListener('click', () => this.closePanel(bar, spec.id));
    head.appendChild(close);
    const content = make('div', 'atlas-connect-tray__content');
    shell.append(head, content);
    tray.appendChild(shell);
    bar.group?.appendChild(tray);
    const ctx: ViewContext = { viewId: actsOn(bar), kind: 'map', isPlayerView: false };
    const unmount = guarded('A panel mount', null as Disposer | null, () => spec.mount(content, ctx));
    const win = bar.view.doc.defaultView ?? window;
    const place = (): void => keepInView(tray);
    place();
    // What the panel draws a moment later can make it wider.
    const timers = [60, 400].map((wait) => win.setTimeout(place, wait));
    const resize = (): void => place();
    win.addEventListener('resize', resize);
    // Like Atlas's own dropdowns, a press outside the group closes it. A press on one of the group's buttons is that
    // button's to answer (it toggles the panel), and a press in the panel itself is the panel's.
    const doc = bar.view.doc;
    const outside = (event: Event): void => {
      if (event.target instanceof Node && bar.group?.contains(event.target)) return;
      this.closePanel(bar, spec.id);
    };
    doc.addEventListener('pointerdown', outside, true);
    return {
      tray,
      content,
      dispose: () => {
        for (const timer of timers) win.clearTimeout(timer);
        win.removeEventListener('resize', resize);
        doc.removeEventListener('pointerdown', outside, true);
        unmount?.();
      },
    };
  }

  // ---- the toolbar ----------------------------------------------------------------------------------------------

  /** Watches the view for Atlas drawing its toolbar slot anew, which takes the group with it. */
  private watch(bar: Bar): void {
    const { root } = bar.view;
    const win = bar.view.doc.defaultView;
    if (!root || !win) return;
    bar.stops.push(watchTokenContextMenu(bar.view, {
      items: (view, token) => this.tokenItems(view, [token]),
      setIcon: (element, name) => this.env.setIcon(element, name),
      editTokenSections: (view, token) => this.editTokenSections(view, token),
    }));
    // A stock Atlas opens no menu on a scene tab: right-clicking one opens Connect's sections for that tab there.
    const tabMenu = (event: MouseEvent): void => {
      const hit = this.tabAt(bar.view, event.target);
      if (!hit) return;
      // Each section is a list under its heading ("Present to" › the players), as under the scene in the Scenes menu.
      const items = (): MenuItem[] => {
        const live = (this.env.view(bar.view.viewId) ?? bar.view).tabs().find((candidate) => candidate.tabId === hit.tab.tabId);
        return live ? this.tabSections(bar.view, live).map(({ heading, items: rows }): MenuItem => ({ label: heading, icon: 'users', submenu: rows })) : [];
      };
      if (items().length === 0) return;
      event.preventDefault();
      // Under the tab, clear of the tooltip Atlas shows over it.
      const rect = hit.element.getBoundingClientRect();
      this.openMenu(bar, 'tab', items, { x: rect.left, y: rect.bottom + 6 });
    };
    root.addEventListener('contextmenu', tabMenu, true);
    bar.stops.push(() => root.removeEventListener('contextmenu', tabMenu, true));
    let queued = false;
    const again = (): void => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (this.bars.get(bar.view.viewId) !== bar) return;
        // Only when the group is gone and the view is still on the page: watching our own changes would never settle.
        if (!bar.group?.isConnected && root.isConnected) this.sync();
      });
    };
    const observer = new win.MutationObserver(again);
    observer.observe(root, { childList: true, subtree: true });
    bar.observer = observer;
    // A view whose toolbar is not there yet (a map still opening) is looked at again shortly.
    const poll = win.setInterval(again, 1500);
    bar.stops.push(() => { observer.disconnect(); win.clearInterval(poll); });
  }

  private release(id: string, bar: Bar): void {
    for (const stop of bar.stops.splice(0)) stop();
    for (const panelId of [...bar.panels.keys()]) {
      const open = bar.panels.get(panelId);
      bar.panels.delete(panelId);
      guarded('A panel unmount', undefined, () => open?.dispose());
    }
    this.closeMenu(bar);
    bar.group?.remove();
    bar.group = null;
    this.bars.delete(id);
    this.onCoverage();
  }

  private ensureGroup(bar: Bar): HTMLElement | null {
    if (bar.group?.isConnected) return bar.group;
    const end = bar.view.root?.querySelector<HTMLElement>(END) ?? null;
    if (!end) {
      bar.group = null;
      return null;
    }
    // The old group went with Atlas's redraw: what hung on it is gone too.
    bar.items.clear();
    bar.menu = null;
    for (const open of bar.panels.values()) guarded('A panel unmount', undefined, () => open.dispose());
    bar.panels.clear();
    const group = make('div', `${GROUP} relative flex items-center`);
    end.insertBefore(group, end.firstChild);
    // The slot sits beside Atlas's own switch with the bar's spacing.
    end.setCssProps({ gap: '8px' });
    bar.group = group;
    return group;
  }

  private render(bar: Bar): void {
    const group = this.ensureGroup(bar);
    if (!group) return;
    const ctx: ToolbarItemContext = { viewId: actsOn(bar), kind: 'map', isPlayerView: false, ownRemote: false };
    const wanted = [...this.records.toolbar.values()]
      .filter((item) => (item.views ?? ['map']).includes('map') && (item.isVisible === undefined || guarded(`Toolbar item ${item.id} isVisible`, false, () => item.isVisible?.(ctx)) === true))
      .sort((a, b) => (b.priority ?? 50) - (a.priority ?? 50));
    const keep = new Set<string>();
    wanted.forEach((item, index) => {
      keep.add(`item:${item.id}`);
      this.draw(bar, `item:${item.id}`, index, { icon: item.icon, label: item.shortcut ? `${item.label} (${item.shortcut})` : item.label,
        active: guarded(`Toolbar item ${item.id} isActive`, false, () => item.isActive?.(ctx) === true),
        badge: guarded<string | number | true | null>(`Toolbar item ${item.id} badge`, null, () => item.badge?.(ctx) ?? null),
        onClick: () => {
          // What the click opens (a panel for the Atlas view it acts on) opens where it was clicked.
          this.clickedBar = bar;
          try {
            guarded(`Toolbar item ${item.id}`, undefined, () => item.onClick(ctx));
          } finally {
            this.clickedBar = null;
          }
        } });
    });
    // View menu items and palette sections have no button here: each is an Obsidian command too, and the panels and
    // menus beside it cover the rest.
    let order = wanted.length;
    const tokens = bar.view.selectedTokens();
    if (tokens.length > 0 && this.tokenItems(bar.view, tokens).length > 0) {
      keep.add('menu:token');
      this.draw(bar, 'menu:token', order++, { icon: 'user', label: tokens.length === 1 ? `Token: ${tokens[0]!.label}` : `${tokens.length} tokens`, active: bar.menu?.name === 'token', badge: null,
        onClick: () => this.toggleMenu(bar, 'token', () => { const live = this.env.view(bar.view.viewId) ?? bar.view; return this.tokenItems(live, live.selectedTokens()); }) });
    }
    if (this.records.sceneTabSections.size > 0 && bar.view.tabs().length > 0 && this.sceneItems(bar.view).length > 0) {
      keep.add('menu:scenes');
      this.draw(bar, 'menu:scenes', order++, { icon: 'layout-list', label: 'Scenes', active: bar.menu?.name === 'scenes', badge: null, onClick: () => this.toggleMenu(bar, 'scenes', () => this.sceneItems(this.env.view(bar.view.viewId) ?? bar.view)) });
    }
    for (const [key, element] of [...bar.items]) {
      if (keep.has(key)) continue;
      element.remove();
      bar.items.delete(key);
      if (bar.menu && key === `menu:${bar.menu.name}`) this.closeMenu(bar);
    }
    // Panels and the open menu sit last in the group, so the buttons keep their order. One already in its place is left
    // alone: moving a node removes it, and a panel taken out and put back plays its slide-up again, which shows as a flash.
    const after: HTMLElement[] = [...[...bar.panels.values()].map((open) => open.tray), ...(bar.menu && !bar.menu.at ? [bar.menu.element] : [])];
    after.forEach((element, offset) => {
      if (group.children[bar.items.size + offset] !== element) group.insertBefore(element, group.children[bar.items.size + offset] ?? null);
    });
  }

  /** One button of the group, made once and kept: its icon, label, state and badge follow what is registered. */
  private draw(bar: Bar, key: string, index: number, spec: { icon: string; label: string; active: boolean; badge: string | number | true | null; onClick: () => void }): void {
    let item = bar.items.get(key);
    if (!item) {
      item = this.makeButton(spec);
      bar.items.set(key, item);
    }
    const button = item.querySelector<HTMLButtonElement>('button')!;
    if (button.dataset.icon !== spec.icon) {
      button.dataset.icon = spec.icon;
      button.querySelector('svg')?.remove();
      // Obsidian's setIcon empties what it draws into, so it draws into a holder; Atlas's icon is the button's first child.
      const holder = make('span', '');
      this.env.setIcon(holder, spec.icon);
      const svg = holder.querySelector('svg');
      if (svg) button.insertBefore(svg, button.firstChild);
    }
    button.classList.toggle('is-active', spec.active);
    button.setAttribute('aria-label', spec.label);
    button.querySelector('.sr-only')!.textContent = spec.label;
    item.dataset.connectItem = key;
    this.clicks.set(button, spec.onClick);
    button.querySelector('.atlas-connect-badge, .atlas-connect-dot')?.remove();
    if (spec.badge !== null) button.appendChild(make('span', spec.badge === true ? 'atlas-connect-dot' : 'atlas-connect-badge', spec.badge === true ? '' : String(spec.badge)));
    const group = bar.group!;
    const at = group.children[index];
    if (at !== item) group.insertBefore(item, at ?? null);
  }

  private makeButton(spec: { label: string; onClick: () => void }): HTMLElement {
    // The markup of Atlas's own tool button, so its CSS and spacing apply.
    const item = make('div', 'atlas-toolbar-item atlas-connect-item');
    const content = make('div', 'atlas-toolbar-item__content');
    const tool = make('div', 'atlas-tool-button');
    const holder = make('span', '');
    const button = make('button', 'btn btn--toolbar btn--icon btn--toolbar');
    button.appendChild(make('span', 'sr-only', spec.label));
    button.addEventListener('click', () => {
      this.hideTip();
      this.clicks.get(button)?.();
      this.refreshSoon();
    });
    button.addEventListener('pointerenter', () => this.scheduleTip(button));
    button.addEventListener('pointerleave', () => this.hideTip());
    button.addEventListener('blur', () => this.hideTip());
    holder.appendChild(button);
    tool.appendChild(holder);
    content.appendChild(tool);
    item.appendChild(content);
    return item;
  }

  private refreshSoon(): void {
    window.setTimeout(() => this.sync(), 0);
  }

  // ---- the tooltip ----------------------------------------------------------------------------------------------

  private scheduleTip(button: HTMLElement): void {
    this.hideTip();
    const win = button.ownerDocument.defaultView ?? window;
    this.tipTimer = win.setTimeout(() => {
      const text = button.getAttribute('aria-label');
      if (!text) return;
      // Atlas's own tooltip markup, in the page's body as its tooltips are.
      const tip = make('div', 'tooltip-content atlas-connect-tip');
      const inner = make('div', 'tooltip-inner');
      inner.appendChild(make('span', 'tooltip-label', text));
      tip.appendChild(inner);
      // Out of the page's flow before it is in the page (`.atlas-connect-tip` is fixed and hidden until placed): a tooltip
      // that is for a moment a block at the end of the body makes the page overflow, the layout shifts under the pointer,
      // and the button loses its hover and gains it again.
      button.ownerDocument.body.appendChild(tip);
      const rect = button.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      const left = Math.max(EDGE, Math.min(rect.left + rect.width / 2 - tipRect.width / 2, win.innerWidth - tipRect.width - EDGE));
      tip.setCssProps({ left: `${left}px`, top: `${Math.max(EDGE, rect.top - tipRect.height - 8)}px` });
      tip.classList.add('is-placed');
      this.tip = tip;
    }, TIP_DELAY_MS);
  }

  private hideTip(): void {
    if (this.tipTimer !== null) window.clearTimeout(this.tipTimer);
    this.tipTimer = null;
    this.tip?.remove();
    this.tip = null;
  }

  // ---- menus (Atlas's dropdown) ---------------------------------------------------------------------------------

  private toggleMenu(bar: Bar, name: string, items: () => MenuItem[]): void {
    if (bar.menu?.name === name) {
      this.closeMenu(bar);
      return;
    }
    this.openMenu(bar, name, items);
  }

  /** Opens a dropdown over the group's buttons, or at `at` (window coordinates) for a right-click. */
  private openMenu(bar: Bar, name: string, items: () => MenuItem[], at?: { x: number; y: number }): void {
    this.closeMenu(bar);
    const element = make('div', at
      ? 'atlas-dropdown-content atlas-connect-menu atlas-connect-menu--at'
      : 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--right atlas-connect-menu');
    const fill = (): void => {
      element.replaceChildren();
      const entries = items();
      // A menu of one list (one scene) opens with that list unfolded: the chevron is there to fold it.
      const only = entries.length === 1 ? entries[0] : undefined;
      if (only?.submenu && !bar.menu) bar.openLists.add(`/${only.label}`);
      this.fillMenu(bar, element, entries, 0, fill, '');
    };
    bar.openLists.clear();
    fill();
    if (at) {
      bar.view.root?.appendChild(element);
      placeAt(element, at);
    } else {
      bar.group?.appendChild(element);
      keepInView(element);
    }
    const doc = bar.view.doc;
    const outside = (event: Event): void => {
      if (event.target instanceof Node && (element.contains(event.target) || bar.group?.contains(event.target))) return;
      this.closeMenu(bar);
      this.render(bar);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      this.closeMenu(bar);
      this.render(bar);
    };
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', escape, true);
    // The panels stay mounted but out of the way while a menu is open: they would lie under it.
    for (const open of bar.panels.values()) open.tray.hidden = true;
    bar.menu = { name, element, stop: () => { doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', escape, true); }, ...(at ? { at } : {}) };
  }

  private closeMenu(bar: Bar): void {
    if (!bar.menu) return;
    bar.menu.stop();
    bar.menu.element.remove();
    bar.menu = null;
    for (const open of bar.panels.values()) open.tray.hidden = false;
  }

  private fillMenu(bar: Bar, into: HTMLElement, items: MenuItem[], depth: number, refill: () => void, path: string): void {
    let section = make('div', 'atlas-dropdown-section');
    into.appendChild(section);
    for (const entry of items) {
      if (entry.label === '-') {
        section = make('div', 'atlas-dropdown-section');
        into.appendChild(section);
        continue;
      }
      if (entry.disabled === true && !entry.onClick && !entry.submenu) {
        section.appendChild(make('div', 'atlas-connect-menu__heading', entry.label));
        continue;
      }
      const row = make('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item');
      const check = make('span', 'atlas-dropdown-menu-item__check');
      if (entry.checked === true) this.env.setIcon(check, 'check');
      row.appendChild(check);
      // A nested row without an icon has no icon column: its label follows the check, under the heading above it.
      if (depth === 0 || entry.icon) {
        const icon = make('span', 'atlas-connect-menu__icon');
        if (entry.icon) this.env.setIcon(icon, entry.icon);
        row.appendChild(icon);
      } else {
        row.classList.add('atlas-connect-menu__nested--bare');
      }
      row.appendChild(make('span', '', entry.label));
      const arrow = make('span', 'atlas-connect-menu__arrow');
      if (entry.submenu) this.env.setIcon(arrow, 'chevron-right');
      row.appendChild(arrow);
      if (depth > 0) row.classList.add('atlas-connect-menu__nested');
      if (entry.disabled === true) row.disabled = true;
      if (entry.submenu) {
        const key = `${path}/${entry.label}`;
        const sub = make('div', 'atlas-connect-menu__sub');
        sub.hidden = !bar.openLists.has(key);
        arrow.classList.toggle('is-open', !sub.hidden);
        row.setAttribute('aria-expanded', String(!sub.hidden));
        this.fillMenu(bar, sub, entry.submenu, depth + 1, refill, key);
        row.addEventListener('click', () => {
          sub.hidden = !sub.hidden;
          arrow.classList.toggle('is-open', !sub.hidden);
          row.setAttribute('aria-expanded', String(!sub.hidden));
          if (sub.hidden) bar.openLists.delete(key);
          else bar.openLists.add(key);
          const menu = into.closest<HTMLElement>('.atlas-connect-menu') ?? into;
          if (bar.menu?.at) placeAt(menu, bar.menu.at);
          else keepInView(menu);
        });
        section.append(row, sub);
        continue;
      }
      row.addEventListener('click', () => {
        guarded(`Menu item ${entry.label}`, undefined, () => entry.onClick?.());
        if (entry.keepOpen === true) {
          refill();
          this.sync();
          return;
        }
        this.closeMenu(bar);
        this.sync();
      });
      section.appendChild(row);
    }
  }

  private tokenItems(view: DockView, tokens: DockToken[]): MenuItem[] {
    const forToken = (token: DockToken): MenuItem[] => {
      const ctx: TokenMenuContext = { viewId: view.contextViewId ?? view.viewId, kind: 'map', isPlayerView: false, tokenId: token.id, tokenKind: token.kind };
      return [...this.records.tokenMenus].flatMap((provider) => guarded('A token menu provider', [] as MenuItem[], () => provider(ctx)));
    };
    if (tokens.length === 1) return forToken(tokens[0]!);
    return tokens.flatMap((token, index) => {
      const items = forToken(token);
      return items.length === 0 ? [] : [{ label: `${token.label} (${index + 1})`, icon: 'user', submenu: items }];
    });
  }

  private editTokenSections(view: DockView, token: DockToken): EditTokenSectionSpec[] {
    const ctx: TokenMenuContext = { viewId: view.contextViewId ?? view.viewId, kind: 'map', isPlayerView: false, tokenId: token.id, tokenKind: token.kind };
    return [...this.records.editTokenSections].flatMap((provider) => guarded('An Edit Token section', [] as EditTokenSectionSpec[], () => {
      const section = provider(ctx);
      return section ? [section] : [];
    }));
  }

  private sceneItems(view: DockView): MenuItem[] {
    return view.tabs().flatMap((tab) => {
      const sections = this.tabSectionItems(view, tab);
      // Every scene has its eye, open or shut as on its tab, so the names line up.
      return sections.length === 0 ? [] : [{ label: tab.presented ? `${tab.name} (presented)` : tab.name, icon: tab.presented ? 'eye' : 'eye-off', submenu: sections }];
    });
  }

  /** What the scene tab sections give for one tab, each under its heading; empty when none gives anything. */
  private tabSectionItems(view: DockView, tab: DockTab): MenuItem[] {
    return this.tabSections(view, tab).flatMap(({ heading, items }) => [{ label: heading, disabled: true }, ...items]);
  }

  /** The scene tab sections that give something for one tab, with their headings. */
  private tabSections(view: DockView, tab: DockTab): Array<{ heading: string; items: MenuItem[] }> {
    const ctx: SceneTabMenuContext = { viewId: view.contextViewId ?? view.viewId, tabId: tab.tabId, mapPath: tab.mapPath, name: tab.name, active: tab.active, presented: tab.presented };
    return [...this.records.sceneTabSections].flatMap((section) => {
      const items = guarded(`Scene tab section ${section.heading}`, [] as MenuItem[], () => section.items(ctx));
      return items.length === 0 ? [] : [{ heading: section.heading.slice(0, 40), items }];
    });
  }

  /** The scene tab of Atlas's tab bar that `target` is in (not the add button), matched to the view's tabs by position. */
  private tabAt(view: DockView, target: EventTarget | null): { tab: DockTab; element: Element } | null {
    const element = target instanceof Element ? target.closest('.atlas-scene-tab') : null;
    if (!element || element.classList.contains('atlas-scene-tab-bar__add')) return null;
    const strip = element.parentElement;
    if (!strip) return null;
    const index = Array.from(strip.children).filter((child) => child.classList.contains('atlas-scene-tab') && !child.classList.contains('atlas-scene-tab-bar__add')).indexOf(element);
    const tab = view.tabs()[index];
    return tab ? { tab, element } : null;
  }
}

