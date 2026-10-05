/** What every layer of the player view gets for one frame. Shared with the web page. */
import type { DecodedImage } from '../../assets/AssetLoader';
import type { PlayerScene, ScenePoint } from '../../scene/sceneTypes';
import type { WorldRect } from '../camera';
import type { ViewSurface } from '../ViewSurface';

/**
 * The loaded image for an asset id, or null while it is missing. Looked up at draw time,
 * never kept: images are released when they leave the scene.
 */
export type ImageLookup = (id: string | null) => DecodedImage | null;

/** What this player's own token moves change in the tokens layer; only their view has it. */
export interface TokenOverlay {
  /** The tokens this player controls: drawn with a highlight ring. */
  controlled: ReadonlySet<string>;
  /** Where tokens being dragged, or waiting for the GM's answer, are drawn instead of their scene position. */
  positions: ReadonlyMap<string, ScenePoint>;
}

export const NO_TOKEN_OVERLAY: TokenOverlay = { controlled: new Set(), positions: new Map() };

export interface LayerFrame {
  scene: PlayerScene;
  images: ImageLookup;
  /** The world area on screen, with a margin; layers skip what lies outside it. */
  visible: WorldRect;
  /** Screen (CSS) pixels per world unit. */
  zoom: number;
  /** World units per device pixel: the thinnest line that shows. */
  pixel: number;
  /** The map's area, or without a map size the scene's content; null for an empty scene. */
  bounds: WorldRect | null;
  overlay: TokenOverlay;
}

export interface PlayerLayer {
  draw(surface: ViewSurface, frame: LayerFrame): void;
  /** Frees what the layer caches (the fog image). */
  dispose?(): void;
}

/** Drawn over the scene (the player's tools); while one animates (a fading laser) the view keeps drawing. */
export interface OverlayLayer extends PlayerLayer {
  animating(): boolean;
}
