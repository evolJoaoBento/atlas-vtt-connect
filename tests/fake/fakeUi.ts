import type {
  DashboardTile, Disposer, MenuItem, PaletteCommand, PaletteSection, PanelHandle, PanelSpec, ToolbarItem, TokenMenuContext, UiApi, ViewContext, ViewId,
} from '@atlas-vtt/api-types';
import type { FakeViews, Own } from './fakeViews';

type Kind = 'toolbar' | 'palette' | 'dashboard' | 'viewMenu' | 'tokenMenu' | 'panel';
type MenuProvider<C> = (ctx: C) => MenuItem[];

/** One registration, with the extension that made it. */
interface Entry<T = unknown> { owner: string; kind: Kind; spec: T }

/** The slot counts `counts()` reports. */
export type SlotCounts = Record<Kind, number>;

/** A toolbar item as the bar draws it for one view. */
export interface DrawnToolbarItem { id: string; icon: string; label: string; priority: number; active: boolean; badge: string | number | true | null }

/** A palette section as the palette draws it for one view. */
export interface DrawnPaletteSection { id: string; title: string; commands: PaletteCommand[] }

interface OpenPanel { container: HTMLElement; dispose: Disposer }

const isText = (value: unknown): boolean => typeof value === 'string' && value !== '';
const VIEW_KINDS = ['map', 'remote'];

/** Atlas's argument check: `call`'s spec must be an object with these fields (`ui/index.ts`, same messages). */
function check(call: string, spec: unknown, fields: Record<string, 'text' | 'string' | 'function'>, optional: Record<string, 'text' | 'function' | 'number'> = {}): void {
  if (typeof spec !== 'object' || spec === null) throw new Error(`[Atlas API] ${call} needs an object.`);
  const record = spec as Record<string, unknown>;
  const kinds = { text: 'a non-empty string', string: 'a string', function: 'a function', number: 'a number' } as const;
  const okay = (kind: 'text' | 'string' | 'function' | 'number', value: unknown): boolean => (kind === 'function' ? typeof value === 'function'
    : kind === 'string' ? typeof value === 'string' : kind === 'number' ? typeof value === 'number' && Number.isFinite(value) : isText(value));
  for (const [field, kind] of Object.entries(fields)) {
    if (!okay(kind, record[field])) throw new Error(`[Atlas API] ${call}: "${field}" must be ${kinds[kind]}.`);
  }
  for (const [field, kind] of Object.entries(optional)) {
    if (record[field] !== undefined && !okay(kind, record[field])) throw new Error(`[Atlas API] ${call}: "${field}" must be ${kinds[kind]} when given.`);
  }
}

/** A badge worth drawing (Atlas's `drawableBadge`): `true`, a finite number (0 included) or a non-empty string. */
function drawableBadge(value: unknown): string | number | true | null {
  if (value === true) return true;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Menu entries as Atlas draws them: items without a label go, submenus keep their drawable children and go when none is left, `checked` and `disabled` belong to plain items. */
function drawableMenu(items: unknown): MenuItem[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown): MenuItem[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { label, icon, onClick, submenu, checked, disabled } = item as MenuItem;
    if (!isText(label)) return [];
    if (submenu !== undefined) {
      const children = drawableMenu(submenu);
      return children.length > 0 ? [{ label, ...(icon ? { icon } : {}), submenu: children }] : [];
    }
    return [{ label, ...(icon ? { icon } : {}), ...(onClick ? { onClick } : {}), ...(checked !== undefined ? { checked: checked === true } : {}), ...(disabled !== undefined ? { disabled: disabled === true } : {}) }];
  });
}

/** Palette commands as Atlas lists them: a malformed command is skipped. */
function drawableCommands(commands: unknown): PaletteCommand[] {
  if (!Array.isArray(commands)) return [];
  return commands.filter((command): command is PaletteCommand => typeof command === 'object' && command !== null
    && isText((command as PaletteCommand).id) && isText((command as PaletteCommand).label) && typeof (command as PaletteCommand).run === 'function');
}

/** An extension callback runs guarded: one that throws is logged and ignored. */
function guarded<T>(what: string, run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    console.error(`[Atlas API] ${what} threw:`, error);
    return fallback;
  }
}

/**
 * Atlas's UI slots as the fake records them (`ui` capability): what each extension registered, with Atlas's
 * checks (one id per extension and slot, frozen copies) and the panels' open state per view. The `draw*`,
 * `palette`, `viewMenu`, `tokenMenu` and panel methods are what Atlas's toolbar, palette and menus do with
 * the registrations; tests drive Connect's UI through them. Player views draw none of the slots.
 */
export class FakeUi {
  private readonly entries = new Set<Entry>();
  private readonly open = new Map<Entry<PanelSpec>, Map<ViewId, OpenPanel>>();
  private versions = 0;

  constructor(private readonly views: FakeViews) {}

  /** How many registrations each slot holds now, from every extension. */
  counts(): SlotCounts {
    const counts: SlotCounts = { toolbar: 0, palette: 0, dashboard: 0, viewMenu: 0, tokenMenu: 0, panel: 0 };
    for (const entry of this.entries) counts[entry.kind]++;
    return counts;
  }

  /** How often an extension asked for the slots to be read again (`invalidate`). */
  version(): number {
    return this.versions;
  }

  /** The toolbar items the bar draws in the view, with `isActive` and `badge` read now. */
  drawToolbar(viewId: ViewId): DrawnToolbarItem[] {
    const ctx = this.ctxOf(viewId);
    if (!this.views.isOpen(viewId)) return [];
    return this.specs<ToolbarItem>('toolbar')
      .filter((item) => (item.views ?? ['map']).includes(ctx.kind))
      .map((item) => ({
        id: item.id, icon: item.icon, label: item.label, priority: item.priority ?? 50,
        active: item.isActive ? guarded('isActive', () => item.isActive!(ctx), false) : false,
        badge: item.badge ? drawableBadge(guarded('badge', () => item.badge!(ctx), null)) : null,
      }));
  }

  /** The user clicks a toolbar button. */
  clickToolbar(id: string, viewId: ViewId): void {
    const item = this.specs<ToolbarItem>('toolbar').find((candidate) => candidate.id === id);
    if (!item) throw new Error(`No toolbar item "${id}".`);
    item.onClick(this.ctxOf(viewId));
  }

  /** The palette's sections for the view, each with the commands it offers now. */
  palette(viewId: ViewId): DrawnPaletteSection[] {
    const ctx = this.ctxOf(viewId);
    if (!this.views.isOpen(viewId)) return [];
    return this.specs<PaletteSection>('palette')
      .map((section) => ({ id: section.id, title: section.title, commands: drawableCommands(guarded('commands', () => section.commands(ctx), [])) }))
      .filter((section) => section.commands.length > 0);
  }

  /** The "More options" menu's extension items for the view. */
  viewMenu(viewId: ViewId): MenuItem[] {
    const ctx = this.ctxOf(viewId);
    if (!this.views.isOpen(viewId)) return [];
    return this.specs<MenuProvider<ViewContext>>('viewMenu').flatMap((provider) => drawableMenu(guarded('view menu provider', () => provider(ctx), [])));
  }

  /** A token's context menu: the extension items, in GM views only. */
  tokenMenu(viewId: ViewId, tokenId: string, tokenKind: TokenMenuContext['tokenKind']): MenuItem[] {
    const ctx = this.ctxOf(viewId);
    if (!this.views.isOpen(viewId)) return [];
    const full: TokenMenuContext = { ...ctx, tokenId, tokenKind };
    return this.specs<MenuProvider<TokenMenuContext>>('tokenMenu').flatMap((provider) => drawableMenu(guarded('token menu provider', () => provider(full), [])));
  }

  /** The dashboard tiles extensions registered. */
  dashboardTiles(): DashboardTile[] {
    return this.specs<DashboardTile>('dashboard');
  }

  /** Where the panel `id` is open: the container its `mount` was given, attached to the document; null when it is closed there. */
  panelContainer(id: string, viewId: ViewId): HTMLElement | null {
    const entry = [...this.open.keys()].find((candidate) => candidate.spec.id === id);
    return (entry && this.open.get(entry)?.get(viewId)?.container) ?? null;
  }

  /** The handle's `open` for a panel by id, as the user's own action would open it (for tests that never saw the handle). */
  openPanel(id: string, viewId: ViewId): void {
    const entry = this.entriesOf<PanelSpec>('panel').find((candidate) => candidate.spec.id === id);
    if (!entry) throw new Error(`No panel "${id}".`);
    this.openIn(entry, viewId);
  }

  /** The panel's own close button (Atlas draws it): closes the panel `id` in the view. */
  closePanel(id: string, viewId: ViewId): void {
    const entry = this.entriesOf<PanelSpec>('panel').find((candidate) => candidate.spec.id === id);
    if (entry) this.closeIn(entry, viewId);
  }

  /** The namespace one extension sees; `own` ties its registrations to that extension's connection. */
  api(owner: string, own: Own): UiApi {
    const add = <T>(kind: Kind, spec: T): Disposer => {
      const entry: Entry<T> = { owner, kind, spec };
      this.entries.add(entry);
      return own(() => { this.entries.delete(entry); });
    };
    const assertNew = (call: string, kind: Kind, id: string): void => {
      if (this.entriesOf<{ id: string }>(kind).some((entry) => entry.owner === owner && entry.spec.id === id)) {
        throw new Error(`[Atlas API] ${call}: "${id}" is already registered by this extension.`);
      }
    };
    const provider = (call: string, kind: 'viewMenu' | 'tokenMenu', fn: unknown): Disposer => {
      if (typeof fn !== 'function') throw new Error(`[Atlas API] ${call} needs a function.`);
      return add(kind, fn);
    };
    return Object.freeze({
      addToolbarItem: (item: ToolbarItem): Disposer => {
        check('ui.addToolbarItem', item, { id: 'text', icon: 'text', label: 'text', onClick: 'function' }, { shortcut: 'text', priority: 'number', isActive: 'function', badge: 'function' });
        const kinds: unknown = item.views;
        if (kinds !== undefined && !(Array.isArray(kinds) && kinds.every((kind) => VIEW_KINDS.includes(kind as string)))) {
          throw new Error('[Atlas API] ui.addToolbarItem: "views" must list \'map\' and \'remote\'.');
        }
        assertNew('ui.addToolbarItem', 'toolbar', item.id);
        return add('toolbar', Object.freeze({ ...item, ...(item.views ? { views: Object.freeze([...item.views]) } : {}) }));
      },
      addPaletteSection: (section: PaletteSection): Disposer => {
        check('ui.addPaletteSection', section, { id: 'text', title: 'text', commands: 'function' });
        assertNew('ui.addPaletteSection', 'palette', section.id);
        return add('palette', Object.freeze({ ...section }));
      },
      addDashboardTile: (tile: DashboardTile): Disposer => {
        check('ui.addDashboardTile', tile, { id: 'text', icon: 'text', title: 'text', description: 'string', onClick: 'function' });
        assertNew('ui.addDashboardTile', 'dashboard', tile.id);
        return add('dashboard', Object.freeze({ ...tile }));
      },
      addViewMenuItems: (fn: MenuProvider<ViewContext>): Disposer => provider('ui.addViewMenuItems', 'viewMenu', fn),
      addTokenMenuItems: (fn: MenuProvider<TokenMenuContext>): Disposer => provider('ui.addTokenMenuItems', 'tokenMenu', fn),
      addPanel: (spec: PanelSpec): PanelHandle => this.addPanel(owner, own, spec, assertNew),
      invalidate: (): void => { this.versions++; },
    });
  }

  private addPanel(owner: string, own: Own, spec: PanelSpec, assertNew: (call: string, kind: Kind, id: string) => void): PanelHandle {
    check('ui.addPanel', spec, { id: 'text', title: 'text', mount: 'function' });
    assertNew('ui.addPanel', 'panel', spec.id);
    const entry: Entry<PanelSpec> = { owner, kind: 'panel', spec: Object.freeze({ id: spec.id, title: spec.title, mount: spec.mount }) };
    this.entries.add(entry);
    let alive = true;
    const dispose = own(() => {
      alive = false;
      this.closeEverywhere(entry);
      this.entries.delete(entry);
    });
    /** The view a call acts on: the one named, or the active map view; null for one that is not open. */
    const target = (viewId?: ViewId): ViewId | null => {
      if (!alive) return null;
      if (viewId === undefined) return this.views.activeViewId();
      return this.views.isOpen(viewId) ? viewId : null;
    };
    const isOpen = (viewId: ViewId): boolean => this.open.get(entry)?.has(viewId) === true;
    return Object.freeze({
      open: (viewId?: ViewId): void => { const id = target(viewId); if (id) this.openIn(entry, id); },
      close: (viewId?: ViewId): void => {
        if (!alive) return;
        if (viewId === undefined) { this.closeEverywhere(entry); return; }
        const id = target(viewId);
        if (id) this.closeIn(entry, id);
      },
      toggle: (viewId?: ViewId): void => {
        const id = target(viewId);
        if (!id) return;
        if (isOpen(id)) this.closeIn(entry, id);
        else this.openIn(entry, id);
      },
      isOpen: (viewId?: ViewId): boolean => { const id = target(viewId); return id !== null && isOpen(id); },
      dispose,
    });
  }

  private openIn(entry: Entry<PanelSpec>, viewId: ViewId): void {
    const ctx = this.ctxOf(viewId);
    const shown = this.open.get(entry) ?? new Map<ViewId, OpenPanel>();
    if (shown.has(viewId)) return;
    this.open.set(entry, shown);
    const container = document.createElement('div');
    document.body.append(container);
    let unmount: Disposer;
    try {
      unmount = entry.spec.mount(container, ctx);
    } catch (error) {
      // Atlas logs a panel that cannot mount and closes it.
      console.error('[Atlas API] A panel mount threw:', error);
      container.remove();
      if (shown.size === 0) this.open.delete(entry);
      return;
    }
    // The view closing closes the panel in it, as Atlas's `closeViewPanels`.
    const stopWatching = this.views.watchClose(viewId, () => this.closeIn(entry, viewId));
    shown.set(viewId, { container, dispose: () => { stopWatching?.(); guarded('panel unmount', unmount, undefined); container.remove(); } });
  }

  private closeIn(entry: Entry<PanelSpec>, viewId: ViewId): void {
    const shown = this.open.get(entry);
    const panel = shown?.get(viewId);
    if (!shown || !panel) return;
    shown.delete(viewId);
    if (shown.size === 0) this.open.delete(entry);
    panel.dispose();
  }

  private closeEverywhere(entry: Entry<PanelSpec>): void {
    for (const viewId of [...(this.open.get(entry)?.keys() ?? [])]) this.closeIn(entry, viewId);
  }

  private ctxOf(viewId: ViewId): ViewContext {
    return { viewId, kind: 'map', isPlayerView: false };
  }

  private entriesOf<T>(kind: Kind): Array<Entry<T>> {
    return [...this.entries].filter((entry) => entry.kind === kind) as Array<Entry<T>>;
  }

  private specs<T>(kind: Kind): T[] {
    return this.entriesOf<T>(kind).map((entry) => entry.spec);
  }
}
