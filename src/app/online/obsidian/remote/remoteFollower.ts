/**
 * Where a remote view looks, as the join page decides it (`view/CameraController.ts`): it follows the GM's
 * camera of the shown scene, or fits the scene without one, until the player moves the camera themselves
 * or fits the map; Follow GM goes back. Atlas draws the camera (`RemoteView.setCamera`, gliding) and keeps
 * its area in view through resizes; this only decides what to ask for.
 */
import type { RemoteView, ViewCamera } from '@atlas-vtt/api-types';
import { sceneWorldBounds } from '../../preview/previewLayout';
import type { SceneCamera } from '../../scene/sceneCamera';
import type { PlayerScene } from '../../scene/sceneTypes';

const isSize = (value: number): boolean => Number.isFinite(value) && value > 0;

/** A camera Atlas takes: finite numbers with a size above 0; null for anything else. */
function viewCamera(area: { centerX: number; centerY: number; width: number; height: number }): ViewCamera | null {
  const { centerX, centerY, width, height } = area;
  return Number.isFinite(centerX) && Number.isFinite(centerY) && isSize(width) && isSize(height) ? { centerX, centerY, width, height } : null;
}

const sameCamera = (a: ViewCamera | null, b: ViewCamera | null): boolean => a !== null && b !== null
  && a.centerX === b.centerX && a.centerY === b.centerY && a.width === b.width && a.height === b.height;

export class RemoteFollower {
  private following = true;
  private sceneId: string | null = null;
  private fitted: ViewCamera | null = null;
  private gm: SceneCamera | null = null;
  private asked: ViewCamera | null = null;
  private readonly stopListening: () => void;

  constructor(private readonly view: Pick<RemoteView, 'setCamera' | 'onCameraMoved'>, private readonly onFollowingChange: () => void) {
    // The player panned or zoomed (`byUser`), or Atlas's own Fit map ran: either way the view stops following, as the fork's did.
    this.stopListening = view.onCameraMoved(() => this.setFollowing(false));
  }

  get isFollowing(): boolean {
    return this.following;
  }

  /** The shown scene. A new scene returns to following and jumps there; a scene whose bounds moved refits a follower. */
  setScene(scene: PlayerScene | null): void {
    const sceneId = scene?.sceneId ?? null;
    const bounds = scene ? sceneWorldBounds(scene) : null;
    const fitted = bounds ? viewCamera({ centerX: bounds.x + bounds.width / 2, centerY: bounds.y + bounds.height / 2, width: bounds.width, height: bounds.height }) : null;
    if (sceneId !== this.sceneId) {
      this.sceneId = sceneId;
      this.fitted = fitted;
      this.asked = null;
      this.setFollowing(true);
      this.go(false);
      return;
    }
    if (sameCamera(fitted, this.fitted) || (fitted === null && this.fitted === null)) return;
    this.fitted = fitted;
    if (this.following) this.go(true);
  }

  /** The GM's latest camera, whatever its scene: it is used once its scene is shown. */
  setGmCamera(camera: SceneCamera | null): void {
    this.gm = camera;
    if (this.following && camera?.sceneId === this.sceneId) this.go(true);
  }

  /** Back to following: glide to the GM's camera, or fit the scene without one. */
  followGm(): void {
    this.setFollowing(true);
    this.asked = null;
    this.go(true);
  }

  /**
   * Shows the whole scene with the margin Atlas's own Fit map leaves (`padded`, API 1.15; an older Atlas ignores it); the
   * player stays broken away. A scene without bounds has nothing to fit, and follows on.
   */
  fitMap(): void {
    if (!this.fitted) return;
    this.setFollowing(false);
    this.ask(this.fitted, true, true);
  }

  dispose(): void {
    this.stopListening();
  }

  private target(): ViewCamera | null {
    const gm = this.gm;
    if (gm && gm.sceneId === this.sceneId) return viewCamera(gm);
    return this.fitted;
  }

  private go(animate: boolean): void {
    const target = this.target();
    // The same camera again (the GM's resends) must not restart the glide.
    if (!target || sameCamera(target, this.asked)) return;
    this.ask(target, animate);
  }

  private ask(camera: ViewCamera | null, animate: boolean, padded = false): void {
    if (!camera) return;
    this.asked = camera;
    this.view.setCamera(camera, padded ? { animate, padded } : { animate });
  }

  private setFollowing(following: boolean): void {
    if (following === this.following) return;
    this.following = following;
    this.onFollowingChange();
  }
}
