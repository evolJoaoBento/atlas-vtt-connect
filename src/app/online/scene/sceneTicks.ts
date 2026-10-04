/**
 * The broadcaster's timing and what one projection sends: a tick batches the changes of up to
 * `SCENE_TICK_MS`, and a projection's snapshot messages are built once and kept while it is what
 * players have. A scene too large to send tells the GM once per presentation.
 */
import { snapshotMessages, type SceneOutgoing } from './sceneMessages';
import { SCENE_TICK_MS, SCENE_TOO_LARGE_NOTICE } from './sceneSources';
import type { PlayerScene } from './sceneTypes';

/** At most one tick waits; scheduling again while one waits changes nothing. */
export class TickTimer {
  private timer: number | null = null;

  constructor(private readonly run: () => void) {}

  schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.run();
    }, SCENE_TICK_MS);
  }

  cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}

/** The snapshot messages of the scene players have, built once per projection. */
export class SnapshotCache {
  private snapshot: { scene: PlayerScene; messages: SceneOutgoing[] | null } | null = null;
  /** The presentation whose oversize the GM was told about, so the notice shows once. */
  private noticeShownFor: string | null = null;

  constructor(private readonly notify: (message: string) => void) {}

  /** Null when `scene` is too large to send: players then get a clear, never a stale or partial scene. */
  messagesOf(scene: PlayerScene): SceneOutgoing[] | null {
    if (this.snapshot?.scene !== scene) {
      this.snapshot = { scene, messages: snapshotMessages(scene) };
      if (!this.snapshot.messages && this.noticeShownFor !== scene.sceneId) {
        this.noticeShownFor = scene.sceneId;
        this.notify(SCENE_TOO_LARGE_NOTICE);
      }
    }
    return this.snapshot.messages;
  }

  /** Whether the snapshot of `scene` was tried and was too large. */
  failed(scene: PlayerScene): boolean {
    return this.snapshot?.scene === scene && this.snapshot.messages === null;
  }

  forget(): void {
    this.snapshot = null;
  }
}
