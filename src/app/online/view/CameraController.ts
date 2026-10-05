/**
 * Where the player looks. By default it follows the GM: each GM camera of the shown
 * scene glides the view there in `GLIDE_MS`. A pan or zoom by the player breaks away
 * until `followGm`. Without a GM camera it fits the map (or, without a map size, the
 * scene's content). The GM's latest camera is kept whatever its scene and used once
 * that scene is shown. Time is injected, so tests drive it. Shared with the web page.
 */
import { sceneWorldBounds } from '../preview/previewLayout';
import type { SceneCamera } from '../scene/sceneCamera';
import type { PlayerScene } from '../scene/sceneTypes';
import {
  cameraForView, cameraLimits, clampCamera, DEFAULT_CAMERA, fitCamera, GLIDE_MS, interpolateCamera, panBy, sameRect, screenToWorld, zoomAround,
  type Camera, type CameraLimits, type ScreenPoint, type ScreenSize, type WorldRect,
} from './camera';

export interface CameraControllerOptions {
  now(): number;
  /** The camera, or whether it follows, changed: draw again. */
  onChange(): void;
}

interface Glide {
  from: Camera;
  to: Camera;
  start: number;
}

const sameCamera = (a: Camera, b: Camera): boolean => a.centerX === b.centerX && a.centerY === b.centerY && a.zoom === b.zoom;

export class CameraController {
  private screen: ScreenSize = { width: 0, height: 0 };
  private sceneId: string | null = null;
  private bounds: WorldRect | null = null;
  private gm: SceneCamera | null = null;
  private following = true;
  private camera: Camera = DEFAULT_CAMERA;
  private glide: Glide | null = null;

  constructor(private readonly options: CameraControllerOptions) {}

  /** The camera to draw with now, mid-glide included. */
  current(): Camera {
    const glide = this.glide;
    if (!glide) return this.camera;
    const t = (this.options.now() - glide.start) / GLIDE_MS;
    if (t < 1) return interpolateCamera(glide.from, glide.to, t);
    this.glide = null;
    this.camera = glide.to;
    return this.camera;
  }

  /** Whether a glide is under way, so the view keeps drawing frames. */
  isMoving(): boolean {
    return this.glide !== null && this.options.now() - this.glide.start < GLIDE_MS;
  }

  isFollowing(): boolean {
    return this.following;
  }

  /** The world point under `point` (CSS pixels from the canvas's top left), with the camera of now. */
  toWorld(point: ScreenPoint): ScreenPoint {
    return screenToWorld(this.current(), this.screen, point);
  }

  /** The canvas's size in CSS pixels. A following view refits; one that broke away keeps its centre. */
  setScreen(screen: ScreenSize): void {
    if (screen.width === this.screen.width && screen.height === this.screen.height) return;
    this.screen = { width: screen.width, height: screen.height };
    // A canvas with no size (hidden, not laid out) changes nothing: the view refits or clamps once it has one.
    if (!(screen.width > 0 && screen.height > 0)) return;
    this.jump(this.following ? this.target() : clampCamera(this.current(), this.limits()));
  }

  /** The shown scene. A new scene (new `sceneId`) returns to following; none resets the camera. */
  setScene(scene: PlayerScene | null): void {
    const sceneId = scene?.sceneId ?? null;
    const bounds = scene ? sceneWorldBounds(scene) : null;
    if (sceneId !== this.sceneId) {
      this.sceneId = sceneId;
      this.bounds = bounds;
      this.following = true;
      this.jump(scene ? this.target() : DEFAULT_CAMERA);
      return;
    }
    if (sameRect(bounds, this.bounds)) return;
    this.bounds = bounds;
    // Without a map size the content decides the bounds, and it moves with the tokens.
    if (this.following) this.glideTo(this.target());
    else this.jump(clampCamera(this.current(), this.limits()));
  }

  /** The GM's latest camera, whatever its scene: it is used once its scene is shown. */
  setGmCamera(camera: SceneCamera | null): void {
    this.gm = camera;
    if (!this.following || this.sceneId === null || camera?.sceneId !== this.sceneId) return;
    const target = this.target();
    // The same camera again (the GM's resends) must not restart the glide.
    if (sameCamera(target, this.glide?.to ?? this.camera)) return;
    this.glideTo(target);
  }

  pan(dx: number, dy: number): void {
    const from = this.current();
    this.breakAway(from, panBy(from, dx, dy, this.limits()));
  }

  zoomAt(point: ScreenPoint, factor: number): void {
    const from = this.current();
    this.breakAway(from, zoomAround(from, this.screen, point, factor, this.limits()));
  }

  /** Back to following: glide to the GM's camera, or fit the map without one. */
  followGm(): void {
    this.following = true;
    this.glideTo(this.target());
  }

  /** Shows the whole map; the player stays broken away. */
  fitMap(): void {
    this.following = false;
    this.glideTo(this.fitted());
  }

  /**
   * The player moved the view themselves (Atlas's viewport: its drag, wheel or pinch): the
   * camera is where they put it and stops following. Nothing to draw, so only the change of
   * following is told.
   */
  movedByPlayer(camera: Camera): void {
    this.glide = null;
    this.camera = camera;
    if (!this.following) return;
    this.following = false;
    this.options.onChange();
  }

  private target(): Camera {
    const gm = this.gm;
    if (gm && gm.sceneId === this.sceneId) return clampCamera(cameraForView(gm, this.screen), this.limits());
    return this.fitted();
  }

  private fitted(): Camera {
    return this.bounds ? fitCamera(this.bounds, this.screen) : DEFAULT_CAMERA;
  }

  private limits(): CameraLimits | null {
    return this.bounds ? cameraLimits(this.bounds, this.screen) : null;
  }

  /** A move that changes nothing (pan 0, zoom 1, or stopped by a limit's edge) keeps a follower following. */
  private breakAway(from: Camera, camera: Camera): void {
    if (sameCamera(from, camera)) return;
    this.following = false;
    this.jump(camera);
  }

  private jump(camera: Camera): void {
    this.glide = null;
    this.camera = camera;
    this.options.onChange();
  }

  private glideTo(to: Camera): void {
    this.glide = { from: this.current(), to, start: this.options.now() };
    this.options.onChange();
  }
}
