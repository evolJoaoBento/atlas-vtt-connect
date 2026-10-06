import type { Disposer, PresentationApi, PresentationListener, PresentationTarget, PresentedSceneInfo, ViewId } from '@atlas-vtt/api-types';
import type { FakeViews, Own } from './fakeViews';

interface Presented {
  /** Names this presentation: kept while it is held and resumed, new for every present. */
  presentationId: string;
  viewId: ViewId;
  tabId: string;
}

/**
 * Which scene players see, with Atlas's `PresentedScene` rules: a scene whose view shows another tab, or
 * whose store does not hold the tab's loaded map, is held; it resumes once the tab is active again and the
 * store holds its map, loaded (checked after the tab change settles and on every store change); closing the
 * tab or the view clears it.
 */
export class FakePresentation {
  private scene: Presented | null = null;
  private held = false;
  private resumeToken = 0;
  private presentations = 0;
  /** The token a resume waits with; null while none waits. */
  private waiting: number | null = null;
  private readonly listeners = new Set<PresentationListener>();
  private readonly added: PresentationTarget[] = [];
  /** Each target's `tabBadge`, read once at `addTarget` with `scene-tabs` (1.17.0); the targets whose badge threw, logged once. */
  private readonly badges = new Map<PresentationTarget, NonNullable<PresentationTarget['tabBadge']>>();
  private readonly badgeFailed = new WeakSet<PresentationTarget>();
  private loading: { viewId: ViewId; tabId: string; resolve: (presented: boolean) => void } | null = null;

  constructor(private readonly views: FakeViews, private readonly tabsEnabled: () => boolean = () => false) {}

  /**
   * The mark after a tab's eye, as Atlas's `tabBadgeFor` (1.17.0): the first active target's non-null badge, control
   * characters replaced, trimmed, cut to 23 characters and "…" past 24; a throw or a value that is not a string is none
   * (logged once per target).
   */
  badgeFor(viewId: ViewId, tabId: string): string | null {
    for (const target of this.added) {
      const badge = this.badges.get(target);
      if (!badge || !this.isActive(target)) continue;
      let value: unknown;
      try {
        value = badge.call(target, { viewId, tabId });
      } catch (error) {
        if (!this.badgeFailed.has(target)) console.error('[Atlas API] A presentation target tabBadge threw:', error);
        this.badgeFailed.add(target);
        continue;
      }
      if (typeof value !== 'string') continue;
      const text = [...value.replace(/\p{Cc}/gu, ' ').trim()];
      if (text.length === 0) continue;
      return text.length > 24 ? `${text.slice(0, 23).join('')}…` : text.join('');
    }
    return null;
  }

  private isActive(target: PresentationTarget): boolean {
    try {
      return target.isActive() === true;
    } catch {
      return false;
    }
  }

  /** The targets extensions hold now, in the order they were added. */
  get targets(): readonly PresentationTarget[] {
    return [...this.added];
  }

  current(): PresentedSceneInfo | null {
    return this.scene ? this.info(this.scene, this.held) : null;
  }

  /**
   * As `presentation.present`: switches the view to the tab, waits until its store holds the tab's map,
   * loaded (Atlas's `whenMapLoaded`), then presents it (`presented(scene, false)`). False for a closed view, an
   * unknown tab, a view closed or a tab removed while waiting, or a held start. When the tab already shows,
   * everything happens before the promise is returned. `switchTab: false` registers the presentation at once,
   * as Atlas's scene does when the view moved on during the switch: held while it does not show the tab.
   */
  present(viewId: ViewId, tabId?: string, options: { switchTab?: boolean } = {}): Promise<boolean> {
    const view = this.views.tabsOf(viewId);
    const target = tabId ?? view?.activeTabId ?? null;
    if (!view || !target || !view.tabs.some((tab) => tab.tabId === target)) return Promise.resolve(false);
    if (options.switchTab === false) return Promise.resolve(this.register(viewId, target));
    this.views.setActiveTab(viewId, target);
    this.loading?.resolve(false);
    this.loading = null;
    if (this.views.showsTab(viewId, target)) return Promise.resolve(this.register(viewId, target));
    return new Promise((resolve) => { this.loading = { viewId, tabId: target, resolve }; });
  }

  /** Atlas's `PresentedScene.present`: held unless the view shows the tab's loaded map. True when presented. */
  private register(viewId: ViewId, target: string): boolean {
    const scene: Presented = { presentationId: `presentation-${++this.presentations}`, viewId, tabId: target };
    this.scene = scene;
    this.held = this.views.tabsOf(viewId)?.activeTabId !== target || !this.views.showsTab(viewId, target);
    this.resumeToken++;
    this.waiting = null;
    if (this.held) {
      this.emit((listener) => listener.held?.(this.info(scene, true)));
      if (this.views.tabsOf(viewId)?.activeTabId === target) this.resumeWhenLoaded();
    } else {
      this.emit((listener) => listener.presented?.(this.info(scene, false), false));
    }
    return !this.held;
  }

  /** A `present` waiting for its tab's map to load, or a view or tab gone meanwhile (it then answers false). */
  private settleLoading(viewId: ViewId): void {
    const loading = this.loading;
    if (!loading || loading.viewId !== viewId) return;
    const tabs = this.views.tabsOf(viewId);
    if (!tabs?.tabs.some((tab) => tab.tabId === loading.tabId)) {
      this.loading = null;
      loading.resolve(false);
    } else if (this.views.showsTab(viewId, loading.tabId)) {
      this.loading = null;
      loading.resolve(this.register(viewId, loading.tabId));
    }
  }

  stop(): void {
    const previous = this.scene;
    if (!previous) return;
    const wasHeld = this.held;
    this.scene = null;
    this.held = false;
    this.resumeToken++;
    this.waiting = null;
    this.emit((listener) => listener.cleared?.(this.info(previous, wasHeld)));
  }

  /** From the views: the presented view's tabs changed. */
  tabsChanged(viewId: ViewId): void {
    this.settleLoading(viewId);
    const scene = this.scene;
    if (!scene || scene.viewId !== viewId) return;
    const view = this.views.tabsOf(viewId);
    if (!view?.tabs.some((tab) => tab.tabId === scene.tabId)) {
      this.stop();
      return;
    }
    if (view.activeTabId !== scene.tabId) {
      this.resumeToken++;
      this.waiting = null;
      if (this.held) return;
      this.held = true;
      this.emit((listener) => listener.held?.(this.info(scene, true)));
      return;
    }
    if (this.held) {
      this.resumeToken++;
      this.resumeWhenLoaded();
    }
  }

  /** From the views: the store of `viewId` changed. */
  storeChanged(viewId: ViewId): void {
    this.settleLoading(viewId);
    if (this.scene?.viewId === viewId && this.waiting === this.resumeToken) this.checkResume(this.resumeToken);
  }

  viewClosed(viewId: ViewId): void {
    this.settleLoading(viewId);
    if (this.scene?.viewId === viewId) this.stop();
  }

  api(own: Own): PresentationApi {
    return Object.freeze({
      current: (): PresentedSceneInfo | null => this.current(),
      present: (viewId: ViewId, tabId?: string): Promise<boolean> => this.present(viewId, tabId),
      stop: (): void => this.stop(),
      subscribe: (listener: PresentationListener): Disposer => {
        this.listeners.add(listener);
        return own(() => { this.listeners.delete(listener); });
      },
      addTarget: (target: PresentationTarget): Disposer => {
        if (!target || typeof target.id !== 'string' || typeof target.label !== 'string' || typeof target.isActive !== 'function') {
          throw new Error('[Atlas API] addTarget needs { id: string, label: string, isActive(): boolean }.');
        }
        if (this.tabsEnabled()) {
          const badge: unknown = target.tabBadge;
          if (badge !== undefined && typeof badge !== 'function') throw new Error('[Atlas API] presentation.addTarget: "tabBadge" must be a function when given.');
          if (typeof badge === 'function') this.badges.set(target, badge as NonNullable<PresentationTarget['tabBadge']>);
        }
        this.added.push(target);
        return own(() => {
          const index = this.added.indexOf(target);
          if (index >= 0) this.added.splice(index, 1);
          this.badges.delete(target);
        });
      },
    });
  }

  /** After the tab change settles (a microtask), then on each store change, until the store holds the tab's map. */
  private resumeWhenLoaded(): void {
    const token = this.resumeToken;
    this.waiting = token;
    void Promise.resolve().then(() => this.checkResume(token));
  }

  private checkResume(token: number): void {
    const scene = this.scene;
    if (!scene || !this.held || token !== this.resumeToken || this.waiting !== token) return;
    if (this.views.tabsOf(scene.viewId)?.activeTabId !== scene.tabId) return;
    if (!this.views.showsTab(scene.viewId, scene.tabId)) return;
    this.waiting = null;
    this.held = false;
    this.emit((listener) => listener.presented?.(this.info(scene, false), true));
  }

  private info(scene: Presented, held: boolean): PresentedSceneInfo {
    const mapPath = this.views.tabsOf(scene.viewId)?.tabs.find((tab) => tab.tabId === scene.tabId)?.mapPath ?? '';
    return Object.freeze({ presentationId: scene.presentationId, viewId: scene.viewId, tabId: scene.tabId, mapPath, held });
  }

  /** Each listener runs guarded, as Atlas's `PresentedScene.emit` does. */
  private emit(call: (listener: PresentationListener) => void): void {
    for (const listener of [...this.listeners]) {
      try {
        call(listener);
      } catch (error) {
        console.error('[Atlas API] A presentation listener failed:', error);
      }
    }
  }
}
