/**
 * The floating, draggable dock that stands in for the slots stock Atlas does not have: the main toolbar, the token
 * context menu, the scene tab menu and the floating panels. View menu items and palette sections have no menu here:
 * each is an Obsidian command too. It follows the map view the GM works in, in that view's own window (a popout has its own document), and is laid out
 * like the dice panel of Atlas's interactive dice extension: a fixed panel with a grip, a title and a collapse button.
 * Positions and the collapsed state are remembered. Nothing it adds to the page outlives `stop()`.
 */
import type { Disposer, MenuItem, PanelSpec, SceneTabMenuContext, TokenMenuContext, ToolbarItem, ToolbarItemContext, ViewContext } from '@atlas-vtt/api-types';
import { clampToWindow, makeDraggable, placeAt, type Place } from './floatingDrag';
import type { PanelHost, UiRecords } from './uiRegistry';

export interface DockToken {
  id: string;
  kind: 'token' | 'character';
  label: string;
}

export interface DockTab {
  tabId: string;
  mapPath: string;
  name: string;
  active: boolean;
  presented: boolean;
}

/** A map view as the dock reads it. */
export interface DockView {
  viewId: string;
  /** The document of the window the view is in. */
  doc: Document;
  /** The view's root element, where Atlas's own toolbar is; null when it has none to read. */
  root: HTMLElement | null;
  selectedTokens(): DockToken[];
  /** The token under a point of the window, when Atlas can say. */
  tokenAt?(clientX: number, clientY: number): DockToken | null;
  tabs(): DockTab[];
}

/** The part of Obsidian's menu the dock uses; `setSubmenu` is not in its typings but exists at runtime. */
export interface MenuItemLike {
  setTitle(title: string): unknown;
  setIcon(icon: string | null): unknown;
  setChecked(checked: boolean | null): unknown;
  setDisabled(disabled: boolean): unknown;
  onClick(callback: () => void): unknown;
  setSubmenu?(): MenuLike;
}
export interface MenuLike {
  addItem(callback: (item: MenuItemLike) => void): unknown;
  addSeparator(): unknown;
  showAtPosition(position: { x: number; y: number }, doc?: Document): unknown;
}

export interface DockEnv {
  activeView(): DockView | null;
  view(viewId: string): DockView | null;
  /** Every open map view. */
  views(): DockView[];
  /** Calls `listener` when the active view, the open views, a selection or the tabs may have changed. */
  watch(listener: () => void): Disposer;
  menu(): MenuLike;
  setIcon(element: HTMLElement, name: string): void;
  memory: { get(key: string): unknown; set(key: string, value: unknown): void };
}

const LABEL_PRIORITY = 50;
const DEFAULT_MARGIN = 16;
const DEFAULT_TOP = 72;
const PANEL_WIDTH = 320;
const PANEL_GAP = 12;
/** When a panel is placed again, until its owner moves it: what it renders may follow its mount by a moment. */
const SETTLE_MS = [60, 400];

interface OpenPanel {
  element: HTMLElement;
  dispose: Disposer;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  // Adopted by the window it is added to: a popout's document takes it as its own.
  return createEl(tag, { cls, ...(text !== undefined && { text }) });
}

const isPlace = (value: unknown): value is Place => typeof value === 'object' && value !== null
  && Number.isFinite((value as Place).x) && Number.isFinite((value as Place).y);

function guarded<T>(what: string, fallback: T, call: () => T): T {
  try {
    return call();
  } catch (error) {
    console.error(`[Atlas VTT Connect] ${what} failed:`, error);
    return fallback;
  }
}

export class FloatingDock implements PanelHost {
  private root: HTMLElement | null = null;
  private rootDoc: Document | null = null;
  private stopDrag: Disposer | null = null;
  private stopWatching: Disposer | null = null;
  private readonly panels = new Map<string, OpenPanel>();

  constructor(
    private readonly records: UiRecords,
    private readonly env: DockEnv,
    /** Whether the dock stands in for this view's toolbar: not where Connect is in Atlas's own. */
    private readonly standsIn: (viewId: string) => boolean = () => true,
  ) {}

  start(): Disposer {
    this.stopWatching = this.env.watch(() => this.refresh());
    this.refresh();
    return () => this.stop();
  }

  stop(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    for (const key of [...this.panels.keys()]) this.closeKey(key);
    this.removeRoot();
  }

  /** Draws the dock again from what is registered and what the active view shows; closes panels of views that went. */
  refresh(): void {
    for (const key of [...this.panels.keys()]) {
      if (!this.env.view(viewOfKey(key))) this.closeKey(key);
    }
    const view = this.env.activeView();
    if (!view || !this.hasSlots() || !this.standsIn(view.viewId)) {
      this.removeRoot();
      return;
    }
    const root = this.ensureRoot(view.doc);
    const body = root.querySelector<HTMLElement>('.atlas-connect-dock__body');
    if (!body) return;
    body.replaceChildren();
    this.drawBody(body, view);
    root.classList.toggle('is-collapsed', this.env.memory.get('dock.collapsed') === true);
  }

  // ---- panels ---------------------------------------------------------------------------------------------------

  open(panelId: string, viewId: string | undefined): void {
    const view = viewId === undefined ? this.env.activeView() : this.env.view(viewId);
    const spec = this.records.panels.get(panelId);
    if (!view || !spec) return;
    const key = keyOf(panelId, view.viewId);
    const open = this.panels.get(key);
    if (open) {
      open.element.parentElement?.appendChild(open.element);
      return;
    }
    this.panels.set(key, this.createPanel(spec, view));
    // The toolbar reads `isActive` from the panel: draw it again.
    this.refresh();
  }

  close(panelId: string, viewId: string | undefined): void {
    if (viewId !== undefined) this.closeKey(keyOf(panelId, viewId));
    else for (const key of [...this.panels.keys()]) if (panelOfKey(key) === panelId) this.closeKey(key);
    this.refresh();
  }

  isOpen(panelId: string, viewId: string | undefined): boolean {
    const id = viewId ?? this.env.activeView()?.viewId;
    return id !== undefined && this.panels.has(keyOf(panelId, id));
  }

  remove(panelId: string): void {
    for (const key of [...this.panels.keys()]) if (panelOfKey(key) === panelId) this.closeKey(key);
  }

  private closeKey(key: string): void {
    const open = this.panels.get(key);
    if (!open) return;
    this.panels.delete(key);
    guarded('A panel unmount', undefined, () => open.dispose());
    open.element.remove();
  }

  private createPanel(spec: PanelSpec, view: DockView): OpenPanel {
    const { doc } = view;
    const element = make('div', 'atlas-connect-window');
    const header = make('div', 'atlas-connect-window__header');
    const grip = make('div', 'atlas-connect-window__grip');
    const gripIcon = make('span', 'atlas-connect-window__icon');
    this.env.setIcon(gripIcon, 'grip-vertical');
    grip.append(gripIcon, make('span', 'atlas-connect-window__title', spec.title));
    const closeButton = make('button', 'atlas-connect-window__close');
    closeButton.setAttribute('aria-label', `Close ${spec.title}`);
    this.env.setIcon(closeButton, 'x');
    header.append(grip, closeButton);
    const container = make('div', 'atlas-connect-window__content');
    element.append(header, container);
    doc.body.appendChild(element);
    const win = doc.defaultView ?? window;
    const stopDrag = makeDraggable(element, grip, (place) => this.env.memory.set(`panel.${spec.id}`, place));
    const ctx: ViewContext = { viewId: view.viewId, kind: 'map', isPlayerView: false };
    const unmount = guarded('A panel mount', null as Disposer | null, () => spec.mount(container, ctx));
    // Placed once its content is there, so its real size decides: beside the dock, so neither hides the other.
    // What the panel draws a moment later (its React) can make it larger, so it is placed again shortly after.
    const saved = this.env.memory.get(`panel.${spec.id}`);
    const place = (): void => {
      const size = { width: element.offsetWidth || PANEL_WIDTH, height: element.offsetHeight || 240 };
      const dock = this.root?.getBoundingClientRect();
      const beside = { x: (dock?.left ?? win.innerWidth - DEFAULT_MARGIN) - size.width - PANEL_GAP, y: dock?.top || DEFAULT_TOP };
      placeAt(element, clampToWindow(isPlace(saved) ? saved : beside, size, win));
    };
    let moved = false;
    place();
    const timers = SETTLE_MS.map((wait) => win.setTimeout(() => { if (!moved) place(); }, wait));
    // Pressed, a panel comes to the front, and stays where its owner put it.
    element.addEventListener('pointerdown', () => {
      moved = true;
      if (element.nextElementSibling) doc.body.appendChild(element);
    });
    const open: OpenPanel = {
      element,
      dispose: () => {
        for (const timer of timers) win.clearTimeout(timer);
        stopDrag();
        unmount?.();
      },
    };
    closeButton.addEventListener('click', () => this.close(spec.id, view.viewId));
    return open;
  }

  // ---- the dock -------------------------------------------------------------------------------------------------

  private hasSlots(): boolean {
    const { records } = this;
    return records.toolbar.size > 0 || records.tokenMenus.size > 0
      || records.sceneTabSections.size > 0;
  }

  private ensureRoot(doc: Document): HTMLElement {
    if (this.root && this.rootDoc === doc && this.root.isConnected) return this.root;
    this.removeRoot();
    const root = make('div', 'atlas-connect-dock');
    const header = make('div', 'atlas-connect-dock__header');
    const grip = make('div', 'atlas-connect-dock__grip');
    const gripIcon = make('span', 'atlas-connect-dock__icon');
    this.env.setIcon(gripIcon, 'grip-vertical');
    grip.append(gripIcon, make('span', 'atlas-connect-dock__title', 'Atlas VTT Connect'));
    const collapse = make('button', 'atlas-connect-dock__collapse');
    collapse.setAttribute('aria-label', 'Collapse or expand the Connect panel');
    this.env.setIcon(collapse, 'chevrons-up-down');
    collapse.addEventListener('click', () => {
      this.env.memory.set('dock.collapsed', this.env.memory.get('dock.collapsed') !== true);
      this.refresh();
    });
    header.append(grip, collapse);
    const body = make('div', 'atlas-connect-dock__body');
    root.append(header, body);
    doc.body.appendChild(root);
    const win = doc.defaultView ?? window;
    const saved = this.env.memory.get('dock.place');
    const size = { width: root.offsetWidth || 200, height: root.offsetHeight || 48 };
    const start = isPlace(saved) ? saved : { x: win.innerWidth - size.width - DEFAULT_MARGIN, y: DEFAULT_TOP };
    placeAt(root, clampToWindow(start, size, win));
    this.stopDrag = makeDraggable(root, grip, (place) => this.env.memory.set('dock.place', place));
    this.root = root;
    this.rootDoc = doc;
    return root;
  }

  private removeRoot(): void {
    this.stopDrag?.();
    this.stopDrag = null;
    this.root?.remove();
    this.root = null;
    this.rootDoc = null;
  }

  private drawBody(body: HTMLElement, view: DockView): void {
    const doc = view.doc;
    const ctx: ToolbarItemContext = { viewId: view.viewId, kind: 'map', isPlayerView: false, ownRemote: false };
    const items = [...this.records.toolbar.values()]
      .filter((item) => (item.views ?? ['map']).includes('map') && (item.isVisible === undefined || guarded(`Toolbar item ${item.id} isVisible`, false, () => item.isVisible!(ctx)) === true))
      .sort((a, b) => (b.priority ?? LABEL_PRIORITY) - (a.priority ?? LABEL_PRIORITY));
    for (const item of items) body.appendChild(this.toolbarButton(doc, item, ctx));
    const tokens = view.selectedTokens();
    if (tokens.length > 0 && this.tokenItems(view, tokens).length > 0) {
      body.appendChild(this.menuButton(doc, 'user', tokens.length === 1 ? `Token: ${tokens[0]!.label}` : `${tokens.length} tokens`, () => this.tokenItems(this.env.view(view.viewId) ?? view, (this.env.view(view.viewId) ?? view).selectedTokens())));
    }
    if (this.records.sceneTabSections.size > 0 && view.tabs().length > 0 && this.sceneItems(view).length > 0) {
      body.appendChild(this.menuButton(doc, 'layout-list', 'Scenes', () => { const live = this.env.view(view.viewId) ?? view; return this.sceneItems(live); }));
    }
  }

  private toolbarButton(doc: Document, item: ToolbarItem, ctx: ViewContext): HTMLElement {
    const button = make('button', 'atlas-connect-dock__button');
    const label = item.shortcut ? `${item.label} (${item.shortcut})` : item.label;
    button.setAttribute('aria-label', label);
    button.setAttribute('data-tooltip-position', 'bottom');
    this.env.setIcon(button, item.icon);
    if (guarded(`Toolbar item ${item.id} isActive`, false, () => item.isActive?.(ctx) === true)) button.classList.add('is-active');
    const badge = guarded<string | number | true | null>(`Toolbar item ${item.id} badge`, null, () => item.badge?.(ctx) ?? null);
    if (badge !== null) button.append(make('span', badge === true ? 'atlas-connect-dock__dot' : 'atlas-connect-dock__badge', badge === true ? '' : String(badge)));
    button.addEventListener('click', () => {
      guarded(`Toolbar item ${item.id}`, undefined, () => item.onClick(ctx));
      this.refresh();
    });
    return button;
  }

  private menuButton(doc: Document, icon: string, label: string, items: () => MenuItem[]): HTMLElement {
    const button = make('button', 'atlas-connect-dock__button');
    button.setAttribute('aria-label', label);
    button.setAttribute('data-tooltip-position', 'bottom');
    this.env.setIcon(button, icon);
    button.addEventListener('click', () => this.showMenu(button, items));
    return button;
  }

  /** Opens the menu under `anchor`; an item that keeps the menu open reads it again and shows it again where it was. */
  private showMenu(anchor: HTMLElement, items: () => MenuItem[]): void {
    const rect = anchor.getBoundingClientRect();
    const position = { x: rect.left, y: rect.bottom };
    const menu = this.env.menu();
    this.fill(menu, items(), () => window.setTimeout(() => this.showMenu(anchor, items), 0));
    menu.showAtPosition(position, anchor.ownerDocument);
  }

  private fill(menu: MenuLike, items: MenuItem[], reopen: () => void): void {
    for (const entry of items) {
      if (entry.label === '-') {
        menu.addSeparator();
        continue;
      }
      let flatten = false;
      menu.addItem((item) => {
        item.setTitle(entry.label);
        if (entry.icon) item.setIcon(entry.icon);
        if (entry.checked !== undefined) item.setChecked(entry.checked);
        if (entry.disabled === true) item.setDisabled(true);
        if (entry.submenu && typeof item.setSubmenu === 'function') {
          this.fill(item.setSubmenu(), entry.submenu, reopen);
          return;
        }
        if (entry.submenu) {
          // This Obsidian has no submenus: the entries follow in place, under the parent's name.
          flatten = true;
          item.setDisabled(true);
          return;
        }
        item.onClick(() => {
          guarded(`Menu item ${entry.label}`, undefined, () => entry.onClick?.());
          this.refresh();
          if (entry.keepOpen === true) reopen();
        });
      });
      if (flatten && entry.submenu) this.fill(menu, entry.submenu.map((child) => ({ ...child, label: `${entry.label} › ${child.label}` })), reopen);
    }
  }

  private tokenItems(view: DockView, tokens: DockToken[]): MenuItem[] {
    const forToken = (token: DockToken): MenuItem[] => {
      const ctx: TokenMenuContext = { viewId: view.viewId, kind: 'map', isPlayerView: false, tokenId: token.id, tokenKind: token.kind };
      return [...this.records.tokenMenus].flatMap((provider) => guarded('A token menu provider', [] as MenuItem[], () => provider(ctx)));
    };
    if (tokens.length === 1) return forToken(tokens[0]!);
    // Several selected tokens: one submenu each, named by the token (two tokens of one name stay apart by position).
    return tokens.flatMap((token, index) => {
      const items = forToken(token);
      return items.length === 0 ? [] : [{ label: `${token.label} (${index + 1})`, icon: 'user', submenu: items }];
    });
  }

  private sceneItems(view: DockView): MenuItem[] {
    return view.tabs().flatMap((tab) => {
      const ctx: SceneTabMenuContext = { viewId: view.viewId, tabId: tab.tabId, mapPath: tab.mapPath, name: tab.name, active: tab.active, presented: tab.presented };
      const sections = [...this.records.sceneTabSections].flatMap((section) => {
        const items = guarded(`Scene tab section ${section.heading}`, [] as MenuItem[], () => section.items(ctx));
        return items.length === 0 ? [] : [{ label: section.heading.slice(0, 40), disabled: true }, ...items];
      });
      return sections.length === 0 ? [] : [{ label: tab.presented ? `${tab.name} (presented)` : tab.name, ...(tab.active ? { icon: 'eye' } : {}), submenu: sections }];
    });
  }
}

const SEPARATOR = '\u0000';
const keyOf = (panelId: string, viewId: string): string => `${panelId}${SEPARATOR}${viewId}`;
const panelOfKey = (key: string): string => key.split(SEPARATOR)[0] ?? '';
const viewOfKey = (key: string): string => key.split(SEPARATOR)[1] ?? '';
