/**
 * The player side's last check on the GM's grid before anything draws it (the join page, the Canvas tab, Atlas's
 * remote view): a grid drawers loop over cell by cell must have finite numbers, cells at least `minSize` px and no
 * more than `cellsPerSide` cells along the map's longer side, and a type and line style the drawers know. The wire
 * validator already holds sizes to `SCENE_RANGES.gridSize`; a size of 1 px on a 200,000 px map passes it and would
 * stall a drawer, so anything else is drawn as no grid. Shared with the web page: no Obsidian imports.
 */
import { PLAYER_GRID_LINES, PLAYER_GRID_TYPES, type PlayerGrid, type PlayerMap, type PlayerScene } from './sceneTypes';

export const GRID_DRAW_LIMITS = { minSize: 2, cellsPerSide: 2000 } as const;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const known = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);

/**
 * Whether a lattice of this type, size and offset lies over `map` within the limits: what Atlas's remote view also
 * gets for a hidden grid it snaps to (`atlasGrid`), which it lays out cell by cell like a visible one.
 */
export function isDrawableGeometry(geometry: { type?: unknown; size?: unknown; offsetX?: unknown; offsetY?: unknown }, map: Pick<PlayerMap, 'width' | 'height'>): boolean {
  const { type, size, offsetX, offsetY } = geometry;
  if (!known(PLAYER_GRID_TYPES, type) || ![size, offsetX, offsetY].every(finite) || (size as number) < GRID_DRAW_LIMITS.minSize) return false;
  const side = Math.max(map.width, map.height);
  return finite(side) && side / (size as number) <= GRID_DRAW_LIMITS.cellsPerSide;
}

/** Whether `grid` can be drawn over `map` without a drawer looping past the limits. */
export function isDrawableGrid(grid: unknown, map: Pick<PlayerMap, 'width' | 'height'>): grid is PlayerGrid {
  if (typeof grid !== 'object' || grid === null) return false;
  const { lineType, lineWidth, opacity } = grid as Partial<Record<keyof PlayerGrid, unknown>>;
  return known(PLAYER_GRID_LINES, lineType) && [lineWidth, opacity].every(finite) && isDrawableGeometry(grid, map);
}

/**
 * The scene as drawers get it: `scene` itself when its grid is drawable or absent, else a copy without a grid,
 * told to `dropped` (the caller logs it once). The same scene gives the same copy, so identity checks still hold.
 */
export function drawableGridFilter(dropped: (grid: unknown) => void): (scene: PlayerScene | null) => PlayerScene | null {
  let last: { from: PlayerScene; to: PlayerScene } | null = null;
  return (scene) => {
    if (!scene || scene.grid === null || isDrawableGrid(scene.grid, scene.map)) return scene;
    if (last?.from !== scene) {
      dropped(scene.grid);
      last = { from: scene, to: { ...scene, grid: null } };
    }
    return last.to;
  };
}
