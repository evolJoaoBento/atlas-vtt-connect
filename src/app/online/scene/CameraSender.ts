/**
 * Sends the GM's working view to the players of the scene it shows, as `scene-camera`. Only the shown slot follows the
 * view (`SlotProjection.shownSlot`: live, its loaded snapshot naming its tab, caught up; P2, P6), and only its audience
 * gets the camera: at most every 100 ms and only when it changed, the last change always included. A parked slot sends
 * nothing and keeps its last camera, which a player moved to it, admitted to it or asking a resync gets after its
 * snapshot. When a slot starts being shown (presented, resumed, back after a clear) its camera goes once more to its
 * players, right after the hub's messages. A second `GmSession` handler beside `SceneHub`, registered after it.
 */
import type { Disposer, ViewCamera, ViewId } from '@atlas-vtt/api-types';
import type { TabScenes } from '../atlas/tabScenes';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { CAMERA_INTERVAL_MS, roundedCamera, sameCamera, type SceneCamera } from './sceneCamera';
import type { PresentedSceneSource, SceneSession } from './sceneSources';
import { isSceneCamera } from './sceneValidation';
import type { SlotChange, SlotProjection, SlotView } from './slotViews';

export interface CameraSenderOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  projection: SlotProjection;
  /** The GM's tabs (`scene-tabs`); without them the view followed is the presented scene's. */
  tabs?: TabScenes | null;
}

/** A view's camera: read now, and each frame it moves. */
interface ViewCameraSource {
  camera(): ViewCamera | null;
  watch(listener: () => void): Disposer;
}

export class CameraSender implements SessionHandler {
  private readonly stops: Array<() => void> = [];
  /** The shown slot whose view is followed. */
  private followed: { sceneId: string; source: ViewCameraSource; stop: Disposer } | null = null;
  /** The last camera each scene's players got, by `sceneId`; forgotten when the scene is freed. */
  private readonly kept = new Map<string, SceneCamera>();
  private cooldown: number | null = null;
  /** The view moved during the cooldown: send once it is over. */
  private dirty = false;

  constructor(private readonly options: CameraSenderOptions) {}

  start(): void {
    this.stops.push(this.options.session.use(this), this.options.projection.onSlotChange((change) => this.changed(change)));
    this.evaluate();
  }

  stop(): void {
    this.unfollow();
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** Runs after the hub's snapshot to this player, since the hub was registered first. */
  onAdmitted(player: SessionPlayer): void {
    this.resend(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'scene-resync') this.resend(player.playerId);
  }

  private changed(change: SlotChange): void {
    if (change.kind === 'freed') this.kept.delete(change.slot.sceneId);
    // The hub sent the move's clear and snapshot already: the scene's camera follows them.
    if (change.kind === 'moved' && change.to?.lastSent) this.sendKept(change.playerId, change.to);
    this.evaluate();
  }

  /** Follows the shown slot once its players have its scene; stops following anything else. */
  private evaluate(): void {
    const shown = this.options.projection.shownSlot();
    const target = shown?.lastSent ? shown : null;
    if (target && target.sceneId === this.followed?.sceneId) return;
    this.unfollow();
    if (target) this.follow(target);
  }

  private follow(slot: SlotView): void {
    const source = this.cameraOf(slot.tab.viewId);
    if (!source) return;
    const followed = { sceneId: slot.sceneId, source, stop: source.watch(() => this.viewMoved()) };
    this.followed = followed;
    // The hub tells its listeners just before it sends: the camera goes right after its messages.
    void Promise.resolve().then(() => {
      if (this.followed === followed) this.send(true);
    });
  }

  private unfollow(): void {
    this.followed?.stop();
    this.followed = null;
    this.dirty = false;
    this.cancelCooldown();
  }

  private cameraOf(viewId: ViewId): ViewCameraSource | null {
    const { tabs, presented } = this.options;
    if (tabs) return { camera: () => tabs.camera(viewId), watch: (listener) => tabs.watchCamera(viewId, listener) };
    const scene = presented.current();
    if (scene?.info.viewId !== viewId) return null;
    return { camera: () => scene.camera(), watch: (listener) => scene.watchCamera(listener) };
  }

  /** Called on every frame of the view: send now, or once the interval is over. */
  private viewMoved(): void {
    if (this.cooldown !== null) {
      this.dirty = true;
      return;
    }
    this.send(false);
  }

  private send(force: boolean): void {
    const camera = this.currentCamera();
    if (!camera || (!force && sameCamera(camera, this.kept.get(camera.sceneId) ?? null))) return;
    this.kept.set(camera.sceneId, camera);
    for (const playerId of this.options.projection.audience(camera.sceneId)) {
      this.options.session.send(playerId, { v: 1, type: 'scene-camera', ...camera });
    }
    this.cancelCooldown();
    this.cooldown = window.setTimeout(() => {
      this.cooldown = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.send(false);
    }, CAMERA_INTERVAL_MS);
  }

  private cancelCooldown(): void {
    if (this.cooldown !== null) window.clearTimeout(this.cooldown);
    this.cooldown = null;
  }

  /**
   * The view's camera for the followed scene, read now; null when the view no longer shows it (a switch began, P2), its
   * players have nothing of it, or without a viewport. Checked at every send, the cooldown's included.
   */
  private currentCamera(): SceneCamera | null {
    const followed = this.followed;
    const shown = this.options.projection.shownSlot();
    if (!followed || shown?.sceneId !== followed.sceneId || !shown.lastSent) return null;
    const view = followed.source.camera();
    if (!view) return null;
    const camera = roundedCamera({ sceneId: followed.sceneId, ...view });
    // Players would drop an invalid camera: a non-finite or out-of-range viewport sends nothing.
    return isSceneCamera({ ...camera }) ? camera : null;
  }

  /** The scene's last camera, to a player who just got its snapshot. */
  private sendKept(playerId: string, slot: SlotView): void {
    const camera = this.kept.get(slot.sceneId);
    if (camera) this.options.session.send(playerId, { v: 1, type: 'scene-camera', ...camera });
  }

  private resend(playerId: string): void {
    const slot = this.options.projection.slotOf(playerId);
    if (slot?.lastSent) this.sendKept(playerId, slot);
  }
}
