import type { Disposer, PresentationApi, PresentationListener, PresentationTarget, PresentedSceneInfo, ViewId } from '@atlas-vtt/api-types';
import type { FakeViews, Own } from './fakeViews';

interface Presented {
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
  /** The token a resume waits with; null while none waits. */
  private waiting: number | null = null;
  private readonly listeners = new Set<PresentationListener>();
  private readonly added: PresentationTarget[] = [];

  constructor(private readonly views: FakeViews) {}

  /** The targets extensions hold now, in the order they were added. */
  get targets(): readonly PresentationTarget[] {
    return [...this.added];
  }

  current(): PresentedSceneInfo | null {
    return this.scene ? this.info(this.scene, this.held) : null;
  }

  /**
   * As `presentation.present`: switches the view to the tab, presents it; false for a closed view, an unknown
   * tab, or a held start. Everything happens before the promise is returned. `switchTab: false` presents as
   * Atlas's scene does when the view moved on during the switch: held while it shows another tab.
   */
  present(viewId: ViewId, tabId?: string, options: { switchTab?: boolean } = {}): Promise<boolean> {
    const view = this.views.tabsOf(viewId);
    const target = tabId ?? view?.activeTabId ?? null;
    if (!view || !target || !view.tabs.some((tab) => tab.tabId === target)) return Promise.resolve(false);
    if (options.switchTab !== false) this.views.setActiveTab(viewId, target);
    const scene: Presented = { viewId, tabId: target };
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
    return Promise.resolve(!this.held);
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
    if (this.scene?.viewId === viewId && this.waiting === this.resumeToken) this.checkResume(this.resumeToken);
  }

  viewClosed(viewId: ViewId): void {
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
        this.added.push(target);
        return own(() => {
          const index = this.added.indexOf(target);
          if (index >= 0) this.added.splice(index, 1);
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
    return Object.freeze({ viewId: scene.viewId, tabId: scene.tabId, mapPath, held });
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
