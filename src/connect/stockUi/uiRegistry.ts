/**
 * The `ui` namespace of the stock Atlas stand-in: what an extension adds to Atlas's UI slots, kept in a registry that
 * the floating dock draws. Stock Atlas has no slots to add to, so the dock (`floatingDock.ts`) stands in for the
 * toolbar, the token context menu, the scene tab menu and the floating panels; view menu items and palette sections
 * are kept but not drawn on a stock Atlas, where each is an Obsidian command too. Validation follows the API's contract: a malformed item throws, naming the call and the field.
 */
import type {
  DashboardTile, Disposer, MenuItem, PaletteSection, PanelHandle, PanelSpec, SceneTabMenuContext, SceneTabMenuSection, TokenMenuContext,
  ToolbarItem, UiApi, ViewContext,
} from '@atlas-vtt/api-types';
import type { EditTokenSectionProvider, EditTokenSectionsApi } from '../../app/online/gm-ui/editTokenSection';

/** What the dock needs of the panels, so `PanelHandle` can open and close them. */
export interface PanelHost {
  open(panelId: string, viewId: string | undefined): void;
  close(panelId: string, viewId: string | undefined): void;
  isOpen(panelId: string, viewId: string | undefined): boolean;
  /** Closes the panel in every view. */
  remove(panelId: string): void;
}

export interface UiRecords {
  readonly toolbar: Map<string, ToolbarItem>;
  readonly palette: Map<string, PaletteSection>;
  readonly tiles: Map<string, DashboardTile>;
  readonly viewMenus: Set<(ctx: ViewContext) => MenuItem[]>;
  readonly tokenMenus: Set<(ctx: TokenMenuContext) => MenuItem[]>;
  readonly panels: Map<string, PanelSpec>;
  readonly sceneTabSections: Set<SceneTabMenuSection>;
  /** Connect's own sections of Atlas's Edit Token dialog: not in Atlas's API, drawn on a stock Atlas only. */
  readonly editTokenSections: Set<EditTokenSectionProvider>;
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function need(call: string, field: string, ok: boolean): void {
  if (!ok) throw new Error(`[Atlas VTT Connect] ${call}: ${field} is missing or malformed`);
}

/** A registry of the slots and the `UiApi` over it; `changed` runs whenever a slot is added, removed or re-read. */
export function createUiRegistry(host: () => PanelHost | null, changed: () => void): { records: UiRecords; api: UiApi & EditTokenSectionsApi; dispose: Disposer } {
  const records: UiRecords = {
    toolbar: new Map(), palette: new Map(), tiles: new Map(), viewMenus: new Set(), tokenMenus: new Set(), panels: new Map(), sceneTabSections: new Set(),
    editTokenSections: new Set(),
  };
  const disposers = new Set<Disposer>();
  let disposed = false;

  const keyed = <T>(map: Map<string, T>, id: string, value: T, call: string): Disposer => {
    need(call, 'id', isText(id));
    if (map.has(id)) throw new Error(`[Atlas VTT Connect] ${call}: id "${id}" is already registered`);
    map.set(id, value);
    changed();
    const remove: Disposer = () => {
      if (map.get(id) !== value) return;
      map.delete(id);
      disposers.delete(remove);
      changed();
    };
    disposers.add(remove);
    return remove;
  };
  const listed = <T>(set: Set<T>, value: T): Disposer => {
    set.add(value);
    changed();
    const remove: Disposer = () => {
      if (!set.delete(value)) return;
      disposers.delete(remove);
      changed();
    };
    disposers.add(remove);
    return remove;
  };

  const api: UiApi & EditTokenSectionsApi = Object.freeze({
    addToolbarItem: (item: ToolbarItem): Disposer => {
      need('ui.addToolbarItem', 'item', typeof item === 'object' && item !== null);
      need('ui.addToolbarItem', 'icon', isText(item.icon));
      need('ui.addToolbarItem', 'label', isText(item.label));
      need('ui.addToolbarItem', 'onClick', typeof item.onClick === 'function');
      return keyed(records.toolbar, item.id, item, 'ui.addToolbarItem');
    },
    addPaletteSection: (section: PaletteSection): Disposer => {
      need('ui.addPaletteSection', 'section', typeof section === 'object' && section !== null);
      need('ui.addPaletteSection', 'title', isText(section.title));
      need('ui.addPaletteSection', 'commands', typeof section.commands === 'function');
      return keyed(records.palette, section.id, section, 'ui.addPaletteSection');
    },
    addDashboardTile: (tile: DashboardTile): Disposer => {
      need('ui.addDashboardTile', 'tile', typeof tile === 'object' && tile !== null);
      need('ui.addDashboardTile', 'icon', isText(tile.icon));
      need('ui.addDashboardTile', 'title', isText(tile.title));
      need('ui.addDashboardTile', 'description', typeof tile.description === 'string');
      need('ui.addDashboardTile', 'onClick', typeof tile.onClick === 'function');
      // Stock Atlas has no dashboard slot to put it in: it is kept, not drawn.
      return keyed(records.tiles, tile.id, tile, 'ui.addDashboardTile');
    },
    addViewMenuItems: (provider: (ctx: ViewContext) => MenuItem[]): Disposer => {
      need('ui.addViewMenuItems', 'provider', typeof provider === 'function');
      return listed(records.viewMenus, provider);
    },
    addTokenMenuItems: (provider: (ctx: TokenMenuContext) => MenuItem[]): Disposer => {
      need('ui.addTokenMenuItems', 'provider', typeof provider === 'function');
      return listed(records.tokenMenus, provider);
    },
    addEditTokenSection: (provider: EditTokenSectionProvider): Disposer => {
      need('ui.addEditTokenSection', 'provider', typeof provider === 'function');
      return listed(records.editTokenSections, provider);
    },
    addPanel: (panel: PanelSpec): PanelHandle => {
      need('ui.addPanel', 'panel', typeof panel === 'object' && panel !== null);
      need('ui.addPanel', 'title', isText(panel.title));
      need('ui.addPanel', 'mount', typeof panel.mount === 'function');
      const { id } = panel;
      const remove = keyed(records.panels, id, panel, 'ui.addPanel');
      let gone = false;
      const handle: PanelHandle = {
        open: (viewId) => { if (!gone) host()?.open(id, viewId); },
        close: (viewId) => { if (!gone) host()?.close(id, viewId); },
        toggle: (viewId) => {
          if (gone) return;
          if (host()?.isOpen(id, viewId)) host()?.close(id, viewId);
          else host()?.open(id, viewId);
        },
        isOpen: (viewId) => !gone && (host()?.isOpen(id, viewId) ?? false),
        dispose: () => {
          if (gone) return;
          gone = true;
          host()?.remove(id);
          remove();
        },
      };
      const dispose = (): void => handle.dispose();
      disposers.add(dispose);
      return Object.freeze(handle);
    },
    addSceneTabMenuSection: (section: SceneTabMenuSection): Disposer => {
      need('ui.addSceneTabMenuSection', 'section', typeof section === 'object' && section !== null);
      need('ui.addSceneTabMenuSection', 'heading', isText(section.heading));
      need('ui.addSceneTabMenuSection', 'items', typeof section.items === 'function');
      return listed(records.sceneTabSections, section);
    },
    invalidate: (): void => { if (!disposed) changed(); },
  });

  return {
    records,
    api,
    dispose: () => {
      disposed = true;
      for (const dispose of [...disposers]) dispose();
      disposers.clear();
    },
  };
}

/** What a scene tab menu section is told about a tab. */
export type { SceneTabMenuContext };
