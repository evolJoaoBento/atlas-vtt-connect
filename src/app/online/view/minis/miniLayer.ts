/**
 * The minis of the tokens layer (the Tabletop extension's 3D GLBs on tokens). The tokens layer hands over each token
 * that has a mini, where it is drawn this frame; the minis are then drawn over the tokens' art and under their bars,
 * badges and nameplates, and under the fog like everything else on the scene. three.js is loaded only once a token with
 * a mini is in view (`miniRenderer.ts`), so a scene without minis costs nothing. A token the player clicks (selects)
 * wobbles its mini. Shared with the web page.
 */
import type { PlayerToken } from '../../scene/sceneTypes';
import type { ViewSurface } from '../ViewSurface';
import type { LayerFrame } from '../layers/layerTypes';
import type { MiniFrameEntry, MiniRenderer } from './miniRenderer';

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

type LoadRenderer = () => Promise<{ MiniRenderer: new (canvas: HTMLCanvasElement, loaded: () => void) => MiniRenderer }>;

export interface MiniLayerOptions {
  now?: () => number;
  /** Tests pass their own; the page and Obsidian load three.js on demand. */
  load?: LoadRenderer;
  /** A bare canvas of the view's document for the minis to be drawn on; without it no mini is drawn. */
  canvas?: () => HTMLCanvasElement | null;
}

export function createMiniLayer(options: MiniLayerOptions = {}): MiniLayer {
  const now = options.now ?? (() => performance.now());
  const load: LoadRenderer = options.load ?? (() => import('./miniRenderer'));
  let renderer: MiniRenderer | null = null;
  let loading: Promise<void> | null = null;
  let failed = false;
  /** A model or three.js arrived: draw again, through `animating`. */
  let dirty = false;
  let entries: MiniFrameEntry[] = [];
  let lastFrame: number | null = null;
  let selected: string | null = null;

  const start = (): void => {
    if (loading || failed) return;
    const canvas = options.canvas?.() ?? null;
    if (!canvas) return;
    loading = load().then(({ MiniRenderer: Renderer }) => {
      renderer = new Renderer(canvas, () => { dirty = true; });
      dirty = true;
    }, (error: unknown) => {
      failed = true;
      console.warn('[Atlas online] The minis could not be drawn:', error);
    });
  };

  return {
    begin(frame): void {
      entries = [];
      // A token the player just selected wobbles its mini.
      const next = frame.overlay.selected ?? null;
      if (next !== selected && next !== null) renderer?.shake(next);
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
      if (entries.length === 0 && !renderer) return;
      const models = frame.models;
      if (!models) return;
      if (!renderer) {
        start();
        return;
      }
      dirty = false;
      const picture = renderer.frame(entries, (asset) => models(asset), frame.visible, frame.pixel, frame.zoom || 1, elapsed);
      if (picture) surface.image(picture, frame.visible.x, frame.visible.y, frame.visible.width, frame.visible.height, null);
    },
    animating: () => dirty || (loading !== null && renderer === null && !failed) || (renderer?.animating() ?? false),
    dispose(): void {
      renderer?.dispose();
      renderer = null;
    },
  };
}
