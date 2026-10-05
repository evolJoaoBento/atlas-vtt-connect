import { darknessOf, NO_DARKNESS, type Darkness } from './darknessFog';
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
  /** Set when the view's lighting could not be read: nothing but the dark map is sent (`closedFrame`). */
  closed?: boolean;
  /**
   * Set when Atlas says lighting hides nothing (`unlit`) on a scene saved lit (dynamic lighting off): the
   * projection is then exactly the unlit one (`OPEN_FRAME`). Only Atlas's own answer gives it.
   */
  open?: boolean;
}

/** Lighting hides nothing: every token as without lighting, no darkness, nothing beyond the map's edge left out. */
export const OPEN_FRAME: LightingFrame = Object.freeze({ seen: () => true, darkness: NO_DARKNESS, open: true });

/** Every token left out and the whole map dark: what players get while the view's lighting cannot be read. */
export function closedFrame(map: MapSize): LightingFrame {
  const darkness = map.width > 0 && map.height > 0
    ? darknessOf({ cols: 1, rows: 1, cellSize: Math.max(map.width, map.height), map, dark: Uint8Array.of(1) })
    : NO_DARKNESS;
  return { seen: () => false, darkness, closed: true };
}
