/**
 * The Canvas 2D scene tab: the presented scene of a session joined from Obsidian, drawn by the join page's own map
 * and tools (`CanvasScene`). It is the player's view on an Atlas without the remote view and needs no Atlas map. It
 * never opens a file. Closing it leaves the session. A tab Obsidian restores at startup has no session and closes
 * itself once the layout is ready.
 */
import { ItemView, type WorkspaceLeaf } from 'obsidian';
import { CanvasScene, type CanvasSceneOptions } from './CanvasScene';
import { buildSceneDom } from './canvasSceneDom';
import { OnlineJoinService } from './OnlineJoinService';
import type { OnlineSceneControls } from './onlineJoinTypes';
import { ONLINE_SCENE_TITLE, ONLINE_SCENE_VIEW_TYPE } from './onlineSceneTab';

export class CanvasSceneView extends ItemView {
  private scene: CanvasScene | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private closed = false;

  /** `drawing` replaces the canvas, frames and 3D dice; Obsidian opens the view with none. */
  constructor(leaf: WorkspaceLeaf, private readonly drawing: Partial<Omit<CanvasSceneOptions, 'dom' | 'service' | 'closeTab' | 'active'>> = {}) {
    super(leaf);
    // Opening a file, a dropped file or back/forward history would replace this tab and leave the session.
    this.navigation = false;
  }

  getViewType(): string {
    return ONLINE_SCENE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return ONLINE_SCENE_TITLE;
  }

  getIcon(): string {
    return 'network';
  }

  /** A session never survives a restart, so the workspace keeps nothing of it. */
  getState(): Record<string, never> {
    return {};
  }

  async setState(): Promise<void> {
    // Nothing to restore: `onOpen` attaches to the session this device joined.
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('atlas-connect-scene-host');
    this.app.workspace.onLayoutReady(() => this.attachSession());
    return Promise.resolve();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.scene?.dispose();
    this.scene = null;
    // Closing the tab leaves the session, also when it closed before attaching; only a copy that gives way to
    // the tab showing the session closes quietly.
    if (!this.otherAttachedView()) OnlineJoinService.forApp(this.app)?.leave();
    return Promise.resolve();
  }

  public onlineControls(): OnlineSceneControls | null {
    return this.scene?.controls ?? null;
  }

  /** Whether this view is the one showing the joined session. */
  get isAttached(): boolean {
    return this.scene !== null;
  }

  /** The leaf of another scene tab that shows the session, if any. */
  private otherAttachedView(): WorkspaceLeaf | undefined {
    return this.app.workspace.getLeavesOfType(ONLINE_SCENE_VIEW_TYPE)
      .find((leaf) => leaf !== this.leaf && leaf.view instanceof CanvasSceneView && leaf.view.isAttached);
  }

  private attachSession(): void {
    if (this.closed || this.scene) return;
    const shown = this.otherAttachedView();
    if (shown) {
      // One tab per session: a copy (a split, a duplicate) gives way to the one that has it.
      this.leaf.detach();
      void this.app.workspace.revealLeaf(shown);
      return;
    }
    const service = OnlineJoinService.forApp(this.app);
    if (!service) {
      this.leaf.detach();
      return;
    }
    const scene = new CanvasScene({
      ...this.drawing, dom: buildSceneDom(this.contentEl), service, closeTab: () => this.leaf.detach(),
      // Keys belong to the tab only while it is the active view: Escape in another pane is not ours.
      active: () => this.app.workspace.getActiveViewOfType(CanvasSceneView) === this,
    });
    if (!scene.attach()) {
      scene.dispose();
      this.contentEl.empty();
      this.leaf.detach();
      return;
    }
    this.scene = scene;
    scene.resize();
    this.resizeObserver = new ResizeObserver(() => scene.resize());
    this.resizeObserver.observe(this.contentEl);
  }
}
