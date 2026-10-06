import type { Disposer, MenuItem, SceneTabMenuContext, SceneTabMenuSection, ViewId } from '@atlas-vtt/api-types';
import { drawableMenu } from './fakeMenus';
import type { FakeViews, Own } from './fakeViews';

/** What the scene tab menu (1.17.0) needs of the rest of the fake: whether `scene-tabs` landed, and the presented tab. */
export interface FakeUiTabs {
  enabled(): boolean;
  presented(): { viewId: ViewId; tabId: string } | null;
}

/** One scene tab menu section, its heading as Atlas keeps it (trimmed, at most 40 characters). */
interface TabSection { heading: string; items: SceneTabMenuSection['items'] }

/** The scene tab eye's menu the GM has open: its rows are read again whenever the slot or the view's tabs changed. */
export interface OpenSceneTabMenu {
  readonly items: MenuItem[];
  readonly isOpen: boolean;
  /** Chooses the item `label`: runs it, and closes the menu unless the item has `keepOpen`. False when there is none. */
  choose(label: string): boolean;
}

/**
 * The scene tab eye's menu sections (`ui.addSceneTabMenuSection`, 1.17.0) as Atlas keeps and draws them: each
 * section's items are read when the menu opens and again after `invalidate`, a registration change, or a change of
 * the view's tabs or of the presented tab (`openSceneTabMenu`), so top-level checkmarks follow.
 */
export class FakeSceneTabMenus {
  private readonly sections = new Set<TabSection>();
  private readonly failed = new WeakSet<TabSection>();

  /** `slotState`: changes when Atlas's slot `subscribe` would fire (an `invalidate`, a registration added or removed). */
  constructor(private readonly views: FakeViews, private readonly tabs: FakeUiTabs, private readonly slotState: () => string) {}

  get count(): number {
    return this.sections.size;
  }

  /** Atlas's checks: an object, a heading non-empty once trimmed (kept at most 40 characters), `items` a function. */
  add(own: Own, section: SceneTabMenuSection): Disposer {
    if (typeof section !== 'object' || section === null) throw new Error('[Atlas API] ui.addSceneTabMenuSection needs an object.');
    const heading = typeof section.heading === 'string' ? [...section.heading.trim()].slice(0, 40).join('') : '';
    if (heading === '') throw new Error('[Atlas API] ui.addSceneTabMenuSection: "heading" must be a non-empty string.');
    if (typeof section.items !== 'function') throw new Error('[Atlas API] ui.addSceneTabMenuSection: "items" must be a function.');
    const kept: TabSection = { heading, items: section.items.bind(section) };
    this.sections.add(kept);
    return own(() => { this.sections.delete(kept); });
  }

  /** The sections for the tab whose eye was right-clicked, read now: a throwing (logged once) or empty section is left out. */
  sectionsFor(viewId: ViewId, tabId: string): Array<{ heading: string; items: MenuItem[] }> {
    const tabs = this.views.tabsOf(viewId);
    const tab = tabs?.tabs.find((entry) => entry.tabId === tabId);
    if (!tabs || !tab || this.views.kindOf(viewId) !== 'map') return [];
    const presented = this.tabs.presented();
    const context: SceneTabMenuContext = Object.freeze({
      viewId, tabId, mapPath: tab.mapPath, name: tab.name, active: tabs.activeTabId === tabId,
      presented: presented?.viewId === viewId && presented.tabId === tabId,
    });
    return [...this.sections].flatMap((section) => {
      let items: MenuItem[];
      try {
        items = drawableMenu(section.items(context));
      } catch (error) {
        if (!this.failed.has(section)) console.error('[Atlas API] A scene tab menu section threw:', error);
        this.failed.add(section);
        return [];
      }
      return items.length > 0 ? [{ heading: section.heading, items }] : [];
    });
  }

  open(viewId: ViewId, tabId: string): OpenSceneTabMenu {
    const read = (): MenuItem[] => this.sectionsFor(viewId, tabId).flatMap((section) => section.items);
    const changes = (): string => `${this.slotState()}:${JSON.stringify([this.views.tabsOf(viewId) ?? null, this.tabs.presented()])}`;
    let items = read();
    let open = items.length > 0;
    let seen = changes();
    const current = (): MenuItem[] => {
      const now = changes();
      if (now !== seen) {
        seen = now;
        items = read();
      }
      return items;
    };
    return {
      get items() { return open ? current() : []; },
      get isOpen() { return open; },
      choose: (label) => {
        const item = open ? current().find((entry) => entry.label === label) : undefined;
        if (!item || item.submenu || item.disabled) return false;
        try {
          item.onClick?.();
        } catch (error) {
          console.error('[Atlas API] A menu item threw:', error);
        }
        if (!item.keepOpen) open = false;
        return true;
      },
    };
  }
}
