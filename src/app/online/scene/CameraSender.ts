/**
 * Sends the GM's working view of the presented scene to admitted players as
 * `scene-camera`. While the scene is live it is sent at most every 100 ms and only
 * when it changed, the last change always included. Nothing is sent while the
 * scene is held, since the view then shows another map. The last camera sent goes
 * once more to everyone when the scene is presented or resumed, and to a player who
 * gets a snapshot (admission, resync), also while held. A second `GmSession`
 * handler beside `SceneBroadcaster`, registered after it, so its messages follow the
 * broadcaster's snapshots.
 */
import type { LiveScene } from '../atlas/presentedSource';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { CAMERA_INTERVAL_MS, roundedCamera, sameCamera, type SceneCamera } from './sceneCamera';
import type { PresentedSceneSource, SceneSession } from './sceneSources';
import type { PlayerScene } from './sceneTypes';
import { isSceneCamera } from './sceneValidation';

/** What the sender needs of the broadcaster: the scene players have, and when that changes. */
export interface CameraProjection {
  currentProjection(): PlayerScene | null;
  onProjection(listener: (scene: PlayerScene | null) => void): () => void;
}

export interface CameraSenderOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  projection: CameraProjection;
}

export class CameraSender implements SessionHandler {
  private readonly stops: Array<() => void> = [];
  /** The live (not held) presentation whose view is followed. */
  private live: LiveScene | null = null;
  private stopWatching: (() => void) | null = null;
  /** Players are about to see the scene (presented, resumed, back after a clear): the camera follows its projection. */
  private announce = false;
  /** The last camera sent; kept while the scene is held, forgotten when it is cleared. */
  private sent: SceneCamera | null = null;
  private cooldown: number | null = null;
  /** The view moved during the cooldown: send once it is over. */
  private dirty = false;

  constructor(private readonly options: CameraSenderOptions) {}

  start(): void {
    const { session, presented, projection } = this.options;
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene) => this.follow(scene),
        held: () => this.unfollow(),
        cleared: () => {
          this.unfollow();
          this.sent = null;
        },
      }),
      projection.onProjection((scene) => this.projected(scene)),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.follow(current);
  }

  stop(): void {
    this.unfollow();
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** Runs after the broadcaster's snapshot to this player, since the broadcaster was registered first. */
  onAdmitted(player: SessionPlayer): void {
    this.resend(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'scene-resync') this.resend(player.playerId);
  }

  private follow(scene: LiveScene): void {
    this.unfollow();
    this.live = scene;
    this.announce = true;
    this.stopWatching = scene.watchCamera(() => this.viewMoved());
    // The broadcaster projected already, unless the map is still loading: then its snapshot after loading announces.
    if (scene.snapshot()?.loaded === true) this.projected(this.options.projection.currentProjection());
  }

  private unfollow(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.live = null;
    this.announce = false;
    this.dirty = false;
    this.cancelCooldown();
  }

  private projected(scene: PlayerScene | null): void {
    if (!scene) {
      // Players got a clear: the camera goes again with the next scene.
      this.announce = this.live !== null;
      return;
    }
    const live = this.live;
    if (!live || !this.announce) return;
    this.announce = false;
    // The broadcaster tells its listeners just before it sends the snapshot: send right after it.
    void Promise.resolve().then(() => {
      if (this.live === live) this.send(true);
    });
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
    if (!camera || (!force && sameCamera(camera, this.sent))) return;
    this.sent = camera;
    for (const player of this.options.session.getPlayers()) {
      if (player.status === 'admitted') this.options.session.send(player.playerId, { v: 1, type: 'scene-camera', ...camera });
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

  /** The view's camera for the scene players have; null while held, before the scene is projected, or without a viewport. */
  private currentCamera(): SceneCamera | null {
    const scene = this.options.projection.currentProjection();
    if (!this.live || this.announce || !scene) return null;
    const view = this.live.camera();
    if (!view) return null;
    const camera = roundedCamera({ sceneId: scene.sceneId, ...view });
    // Players would drop an invalid camera: a non-finite or out-of-range viewport sends nothing.
    return isSceneCamera({ ...camera }) ? camera : null;
  }

  /** The last camera, to a player who just got a snapshot of the same scene. */
  private resend(playerId: string): void {
    const scene = this.options.projection.currentProjection();
    const camera = this.sent;
    if (!scene || !camera || camera.sceneId !== scene.sceneId) return;
    this.options.session.send(playerId, { v: 1, type: 'scene-camera', ...camera });
  }
}
