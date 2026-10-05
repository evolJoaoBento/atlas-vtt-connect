/**
 * Draws the presented scene on a `ViewSurface`: one layer per Atlas layer, in Atlas's
 * order (`SCENE_LAYER_ORDER`). It draws at most once per animation frame and only after
 * something changed (scene, camera, images, size), keeps drawing while the camera
 * glides, and draws nothing while the page is hidden. Frames and visibility are injected,
 * so tests drive it. Shared with the web page.
 */
import { SCENE_LAYER_ORDER, type SceneLayer } from '@atlas-vtt/shared/draw';
import { sceneWorldBounds } from '../preview/previewLayout';
import type { PlayerScene } from '../scene/sceneTypes';
import { visibleArea, type ScreenSize, type WorldRect } from './camera';
import type { CameraController } from './CameraController';
import { NO_TOKEN_OVERLAY, type ImageLookup, type LayerFrame, type OverlayLayer, type PlayerLayer, type TokenOverlay } from './layers/layerTypes';
import type { ViewSurface } from './ViewSurface';

/** Outside the map Atlas's canvas is black. */
export const VIEW_BACKGROUND = '#000000';
/** Phones draw at most two device pixels per CSS pixel: sharper costs more than it shows. */
export const PHONE_PIXEL_RATIO_CAP = 2;
/** World area drawn beyond the screen's edges, in CSS pixels, so shapes crossing the edge are drawn whole. */
const VISIBLE_MARGIN = 64;

/** The ratio to draw at: the device's, capped on phones (a coarse primary pointer). */
export function pixelRatioFor(deviceRatio: number, coarsePointer: boolean): number {
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return coarsePointer ? Math.min(PHONE_PIXEL_RATIO_CAP, ratio) : ratio;
}

export interface PlayerViewRendererOptions {
  surface: ViewSurface;
  camera: CameraController;
  images: ImageLookup;
  /** One per Atlas layer (`createSceneLayers()` on the page); a new Atlas layer fails the build until it has one. */
  layers: Record<SceneLayer, PlayerLayer>;
  /** Drawn over the scene and its fog, in order: the player's tools. */
  overlays?: readonly OverlayLayer[];
  requestFrame(draw: () => void): number;
  cancelFrame(handle: number): void;
  isHidden(): boolean;
}

export class PlayerViewRenderer {
  private scene: PlayerScene | null = null;
  private screen: ScreenSize = { width: 0, height: 0 };
  private ratio = 1;
  private bounds: WorldRect | null = null;
  private overlay: TokenOverlay = NO_TOKEN_OVERLAY;
  private frame: number | null = null;
  private disposed = false;
  private overlayFailed = false;
  /** Layers whose failure was already logged, so a broken one does not flood the console. */
  private readonly failed = new Set<SceneLayer>();

  constructor(private readonly options: PlayerViewRendererOptions) {}

  setScene(scene: PlayerScene | null): void {
    this.scene = scene;
    this.bounds = scene ? sceneWorldBounds(scene) : null;
    this.request();
  }

  /** This player's token moves: the ring on their tokens and where dragged ones are drawn. */
  setOverlay(overlay: TokenOverlay): void {
    this.overlay = overlay;
    this.request();
  }

  /** The canvas's CSS size and the pixel ratio to draw at. */
  setSize(screen: ScreenSize, ratio: number): void {
    this.screen = { width: screen.width, height: screen.height };
    this.ratio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    this.request();
  }

  /** The camera moved or images arrived or went: draw again. */
  invalidate(): void {
    this.request();
  }

  /** The page was shown or hidden; once shown, what changed meanwhile is drawn. */
  visibilityChanged(): void {
    this.request();
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) this.options.cancelFrame(this.frame);
    this.frame = null;
    for (const name of SCENE_LAYER_ORDER) this.options.layers[name].dispose?.();
  }

  /** Draws one frame now. */
  draw(): void {
    const { surface, camera, layers } = this.options;
    const width = Math.max(1, Math.round(this.screen.width * this.ratio));
    const height = Math.max(1, Math.round(this.screen.height * this.ratio));
    surface.begin(width, height, VIEW_BACKGROUND);
    const scene = this.scene;
    if (!scene || this.screen.width <= 0 || this.screen.height <= 0) return;
    const view = camera.current();
    const scale = view.zoom * this.ratio;
    surface.setCamera(scale, width / 2 - view.centerX * scale, height / 2 - view.centerY * scale);
    const frame: LayerFrame = {
      scene,
      images: this.options.images,
      visible: visibleArea(view, { width: this.screen.width + 2 * VISIBLE_MARGIN, height: this.screen.height + 2 * VISIBLE_MARGIN }),
      zoom: view.zoom,
      pixel: 1 / scale,
      bounds: this.bounds,
      overlay: this.overlay,
    };
    // A layer that throws must not hide the others, least of all the fog (drawn last): failing
    // open would show players what the GM hides. The camera is set again to drop any unmatched push.
    for (const name of SCENE_LAYER_ORDER) {
      try {
        layers[name].draw(surface, frame);
      } catch (error) {
        if (!this.failed.has(name)) {
          this.failed.add(name);
          console.error(`[Atlas online] the ${name} layer failed to draw`, error);
        }
        // Without its fog the frame would show what the GM hides: fail closed with a blank view.
        if (name === 'fog' && Object.keys(scene.fog).length > 0) {
          surface.begin(width, height, VIEW_BACKGROUND);
          return;
        }
        surface.setCamera(scale, width / 2 - view.centerX * scale, height / 2 - view.centerY * scale);
      }
    }
    // Above the fog, as Atlas draws its measurements and lasers.
    for (const overlay of this.options.overlays ?? []) {
      try {
        overlay.draw(surface, frame);
      } catch (error) {
        if (!this.overlayFailed) {
          this.overlayFailed = true;
          console.error('[Atlas online] a tool overlay failed to draw', error);
        }
      }
    }
  }

  private request(): void {
    if (this.disposed || this.frame !== null || this.options.isHidden()) return;
    this.frame = this.options.requestFrame(() => {
      this.frame = null;
      // Hidden since the request: skip; visibilityChanged draws what changed once shown.
      if (this.disposed || this.options.isHidden()) return;
      this.draw();
      // A glide moves the camera every frame until it arrives.
      if (this.options.camera.isMoving() || this.animating()) this.request();
    });
  }

  private animating(): boolean {
    return (this.options.overlays ?? []).some((overlay) => overlay.animating());
  }
}
