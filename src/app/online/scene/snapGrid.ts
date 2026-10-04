/**
 * The grid a player's drag snaps to: the one the GM's check of the drop uses (`measurement.snapGrid`),
 * also while players see no grid; null where the GM snaps nothing. From a GM before Atlas 0.5.1-beta.5,
 * which sent none, the grid players see, or a square grid of the map's cell size. Shared with the web page.
 */
import type { PlayerScene, PlayerSnapGrid } from './sceneTypes';

export function snapGridOf(scene: Pick<PlayerScene, 'grid' | 'map' | 'measurement'>): PlayerSnapGrid | null {
  const sent = scene.measurement.snapGrid;
  if (sent !== undefined) return sent;
  const grid = scene.grid;
  return grid
    ? { type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY }
    : { type: 'square', size: scene.map.cellSize, offsetX: 0, offsetY: 0 };
}
