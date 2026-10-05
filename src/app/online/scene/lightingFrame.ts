import { darknessOf, NO_DARKNESS, type Darkness } from './darknessFog';
import type { WorldBounds } from './FogCoverage';
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
  /** The darkness players get drawn over the map (a fog lasso); never what texts and drawings are checked against. */
  darkness: Darkness;
  /**
   * Whether the window shows every part of `bounds` inside the map: true only when each cell of the raster those
   * in-map bounds touch is marked shown (ruling L-POS). An item wholly outside the map, or on a map without size, is
   * not shown; a zero-area one is judged by the cell under it.
   */
  shows(bounds: WorldBounds): boolean;
  /** Set when the view's lighting could not be read: nothing but the dark map is sent (`closedFrame`). */
  closed?: boolean;
  /**
   * Set when Atlas says lighting hides nothing (`unlit`) on a scene saved lit (dynamic lighting off): the
   * projection is then exactly the unlit one (`OPEN_FRAME`). Only Atlas's own answer gives it.
   */
  open?: boolean;
}

/** Lighting hides nothing: every token as without lighting, no darkness, nothing beyond the map's edge left out. */
export const OPEN_FRAME: LightingFrame = Object.freeze({ seen: () => true, darkness: NO_DARKNESS, shows: () => true, open: true });

/** Every token left out and the whole map dark: what players get while the view's lighting cannot be read. */
export function closedFrame(map: MapSize): LightingFrame {
  const darkness = map.width > 0 && map.height > 0
    ? darknessOf({ cols: 1, rows: 1, cellSize: Math.max(map.width, map.height), map, dark: Uint8Array.of(1) })
    : NO_DARKNESS;
  return { seen: () => false, darkness, shows: () => false, closed: true };
}

/** The darkness and the positive check of one raster, worked out together so both read the same cells. */
export interface RasterFrame {
  readonly darkness: Darkness;
  readonly shows: (bounds: WorldBounds) => boolean;
}

export function rasterFrame(grid: DarknessGrid): RasterFrame {
  return { darkness: darknessOf(grid), shows: shownByRaster(grid) };
}

/**
 * Fail closed by construction: the cells the in-map part of `bounds` touches, counted on the raster's own grid
 * (the partial cells at the right and bottom edges included), must each be marked not dark; anything else hides.
 */
function shownByRaster({ cols, rows, cellSize, map, dark }: DarknessGrid): (bounds: WorldBounds) => boolean {
  return (bounds) => {
    const right = bounds.x + Math.max(0, bounds.width);
    const bottom = bounds.y + Math.max(0, bounds.height);
    if (!(map.width > 0 && map.height > 0 && cellSize > 0) || ![bounds.x, bounds.y, right, bottom].every(Number.isFinite)) return false;
    // One that lies, or only touches the map, outside it has no part inside: hidden.
    if (right <= 0 || bottom <= 0 || bounds.x >= map.width || bounds.y >= map.height) return false;
    const c0 = Math.floor(Math.max(bounds.x, 0) / cellSize);
    const r0 = Math.floor(Math.max(bounds.y, 0) / cellSize);
    const c1 = Math.max(c0, Math.ceil(Math.min(right, map.width) / cellSize) - 1);
    const r1 = Math.max(r0, Math.ceil(Math.min(bottom, map.height) / cellSize) - 1);
    if (c1 >= cols || r1 >= rows) return false;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) if (dark[row * cols + col] !== 0) return false;
    }
    return true;
  };
}
