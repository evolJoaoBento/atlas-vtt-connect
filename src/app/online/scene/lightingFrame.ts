import type { Darkness } from './darknessFog';
import type { MapSize } from './sceneTypes';

/**
 * The raster the darkness of a lit scene is read from: one flag per square cell, dark where
 * players see nothing. Atlas computes the picture (`lighting.playerVisibility`); this is its shape here.
 */
export interface DarknessGrid {
  cols: number;
  rows: number;
  cellSize: number;
  map: MapSize;
  dark: Uint8Array;
}

/** What a lit scene adds to the projection: which tokens players see, and the darkness over the map. */
export interface LightingFrame {
  /** Whether players see the token, by the player window's own rule; a token they only sense is not seen. */
  seen(tokenId: string): boolean;
  darkness: Darkness;
}
