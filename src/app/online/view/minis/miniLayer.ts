/**
 * The minis of the tokens layer (the Tabletop extension's 3D GLBs on tokens). The tokens layer hands over each token
 * that has a mini, where it is drawn this frame; the minis are then drawn over the tokens' art and under their bars,
 * badges and nameplates, and under the fog like everything else on the scene. Connect does not draw them itself: the
 * Tabletop extension does, through the painter it offers (`MiniPainter`), so a player sees minis only with Tabletop
 * installed. Without a painter nothing is drawn. A token the player clicks (selects) wobbles its mini.
 */
import type { PlayerToken } from '../../scene/sceneTypes';
import type { ViewSurface } from '../ViewSurface';
import type { LayerFrame } from '../layers/layerTypes';

/** One mini to draw this frame. Part of the painter contract (v1) with the Tabletop extension. */
export interface MiniFrameEntry {
  /** The token's id. */
  id: string;
  /** The asset id of the mini's GLB. */
  asset: string;
  /** Where the token is drawn this frame (gliding or dragged), in world units. */
  x: number;
  y: number;
  /** The token's diameter in world units. */
  size: number;
  /** The token's rotation and the mini's own turn, in degrees. */
  rotation: number;
  turn: number;
  scale: number;
}

/** A world area: what a frame draws over. */
export interface MiniFrameArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One player view's minis, drawn by the painter. */
export interface MiniPainterView {
  /**
   * Draws `entries` over the world area `area`, `pixel` world units to a device pixel, `zoom` screen pixels per world
   * unit, `elapsedMs` after the last frame; returns the picture to lay over that area, or null when there is none yet.
   */
  frame(entries: readonly MiniFrameEntry[], models: (asset: string) => ArrayBuffer | null, area: MiniFrameArea, pixel: number, zoom: number, elapsedMs: number): HTMLCanvasElement | null;
  /** Wobbles a token's mini. */
  shake(id: string): void;
  /** Whether a mini moves on its own (a clip, a lean settling, a model loading): the view keeps drawing. */
  animating(): boolean;
  dispose(): void;
}

/** What the Tabletop extension offers players' views (`api.playerMinis`, version 1). */
export interface MiniPainter {
  version: 1;
  /** A view's minis, drawn on `canvas`; `loaded` asks the view to draw again (a model finished reading). */
  create(canvas: HTMLCanvasElement, loaded: () => void): MiniPainterView;
}

export interface MiniLayer {
  /** Starts a frame. */
  begin(frame: LayerFrame): void;
  /** A token drawn this frame at (`x`, `y`), `size` world units across. */
  add(id: string, token: PlayerToken, x: number, y: number, size: number): void;
  /** Draws the frame's minis. */
  draw(surface: ViewSurface, frame: LayerFrame): void;
  animating(): boolean;
  dispose(): void;
}

export interface MiniLayerOptions {
  now?: () => number;
  /** The Tabletop extension's painter, read every frame: null while it is not installed or not enabled. */
  painter: () => MiniPainter | null;
  /** A bare canvas of the view's document for the minis to be drawn on; without it no mini is drawn. */
  canvas: () => HTMLCanvasElement | null;
}

export function createMiniLayer(options: MiniLayerOptions): MiniLayer {
  const now = options.now ?? (() => performance.now());
  /** The painter `view` came from; a painter that changes (Tabletop reloaded) gets a new view. */
  let painter: MiniPainter | null = null;
  let view: MiniPainterView | null = null;
  /** A painter that threw: not used again until it is replaced. */
  let broken: MiniPainter | null = null;
  /** A model finished reading: draw again, through `animating`. */
  let dirty = false;
  let entries: MiniFrameEntry[] = [];
  let lastFrame: number | null = null;
  let selected: string | null = null;

  const drop = (): void => {
    const old = view;
    view = null;
    painter = null;
    try {
      old?.dispose();
    } catch {
      // The extension's own clean-up failed; nothing of Connect's is left to free.
    }
  };
  const fail = (failed: MiniPainter, error: unknown): void => {
    console.warn('[Atlas online] The Tabletop minis could not be drawn:', error);
    broken = failed;
    drop();
  };
  /** The view of the current painter, made when first needed; null without a painter or a canvas. */
  const current = (): MiniPainterView | null => {
    const next = options.painter();
    if (next !== painter) drop();
    if (!next || next === broken) return null;
    if (view) return view;
    const canvas = options.canvas();
    if (!canvas) return null;
    try {
      view = next.create(canvas, () => { dirty = true; });
      painter = next;
    } catch (error) {
      fail(next, error);
    }
    return view;
  };

  return {
    begin(frame): void {
      entries = [];
      // A token the player just selected wobbles its mini.
      const next = frame.overlay.selected ?? null;
      if (next !== selected && next !== null && view && painter) {
        try {
          view.shake(next);
        } catch (error) {
          fail(painter, error);
        }
      }
      selected = next;
    },
    add(id, token, x, y, size): void {
      const asset = token.mini?.asset;
      if (typeof asset !== 'string') return;
      entries.push({ id, asset, x, y, size, rotation: token.rotation, turn: token.mini?.turn ?? 0, scale: token.mini?.scale ?? 1 });
    },
    draw(surface, frame): void {
      const time = now();
      const elapsed = lastFrame === null ? 0 : time - lastFrame;
      lastFrame = entries.length > 0 ? time : null;
      if (entries.length === 0 && !view) return;
      const models = frame.models;
      if (!models) return;
      const minis = current();
      if (!minis || !painter) return;
      dirty = false;
      let picture: HTMLCanvasElement | null = null;
      try {
        picture = minis.frame(entries, (asset) => models(asset), frame.visible, frame.pixel, frame.zoom || 1, elapsed);
      } catch (error) {
        fail(painter, error);
        return;
      }
      if (picture) surface.image(picture, frame.visible.x, frame.visible.y, frame.visible.width, frame.visible.height, null);
    },
    animating(): boolean {
      if (dirty) return true;
      if (!view || !painter) return false;
      try {
        return view.animating();
      } catch (error) {
        fail(painter, error);
        return false;
      }
    },
    dispose: drop,
  };
}
