/**
 * The grid the player's measuring tools use: the grid the GM's drop snaps to (`snapGridOf`), which is
 * the grid players see when they see one. The measure tool snaps to its cell centres only while players
 * see the grid, like the GM's measure tool (`cellCenterAt`). A dragged token's ruler ends where the GM's
 * drop puts a token of its size (`snapTokenCenter`: where cells meet for Large and Gargantuan), also on a
 * hidden grid, while the GM's snap-to-grid is on; on a map without a grid it does not snap. Without a
 * grid, distances count squares of the map's cell size. Distances are labelled with the GM's measurement
 * settings, as Atlas's ruler labels them, and cones open by the GM's cone angle. Shared with the web page.
 */
import { cellCenterAt, type GridGeometry } from '@atlas-vtt/shared/grid';
import { snapTokenCenter } from '@atlas-vtt/shared/grid';
import { dragRulerLabel } from '@atlas-vtt/shared/draw';
import { snapGridOf } from '../../scene/snapGrid';
import type { PlayerScene, ScenePoint } from '../../scene/sceneTypes';

export interface ToolGrid {
  geometry: GridGeometry;
  /** Where a measured point lands. */
  snap(point: ScenePoint): ScenePoint;
  /** Where a drag ruler point of a token of `tokenSize` lands: the GM's snap-to-grid decides, as for a dropped token, even if the grid is hidden. */
  snapDrag(point: ScenePoint, tokenSize: number): ScenePoint;
  /** The distance along `points`, e.g. "30ft" or a range band's name. */
  label(points: readonly ScenePoint[]): string;
  /** A cone's full opening in radians: the GM's measure tool's, so the game system's. */
  coneOpening: number;
}

export function toolGridOf(scene: PlayerScene): ToolGrid {
  const grid = scene.grid;
  const snapGrid = snapGridOf(scene);
  const geometry: GridGeometry = snapGrid
    ?? (grid ? { type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY } : { type: 'square', size: scene.map.cellSize, offsetX: 0, offsetY: 0 });
  return {
    geometry,
    snap: (point) => (grid ? cellCenterAt(geometry, point) : { x: point.x, y: point.y }),
    snapDrag: (point, tokenSize) => (scene.measurement.snapToGrid && snapGrid
      ? snapTokenCenter(point, tokenSize, snapGrid.type, snapGrid.size, (cell) => cellCenterAt(snapGrid, cell))
      : { x: point.x, y: point.y }),
    label: (points) => dragRulerLabel(geometry, points, scene.measurement),
    coneOpening: (scene.measurement.coneAngle * Math.PI) / 180,
  };
}
