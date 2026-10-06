/**
 * What a grid must be for Atlas to draw it in reasonable time. The drawers step across the map one cell at a
 * time, so a size of 0 or less never ends and a tiny size on a large map takes millions of steps. Grids from
 * outside Atlas (an extension's scene or saved map) are checked against these limits before anything is written;
 * the grid system draws no grid at all for one that breaks them.
 */
/** The smallest cell size, in pixels, a grid from outside Atlas may have. */
export declare const MIN_GRID_CELL_SIZE = 4;
/** The most cells a grid may have along one side of its map. */
export declare const MAX_GRID_CELLS_PER_SIDE = 2000;
/** The farthest a grid's origin may lie from the map's, in pixels: the largest map side a remote scene may have. */
export declare const MAX_GRID_OFFSET = 100000;
/** Whether a grid of cell `size` can be drawn over a map of `width` × `height` pixels. */
export declare function isDrawableGrid(size: number, width: number, height: number): boolean;
/**
 * What is wrong with `grid`, a grid from outside Atlas, in English for the extension's author; null when Atlas can
 * draw it. Only what drawing depends on is checked: the size, the numbers that are set, and the known kinds. `mapSize`
 * is the map it overlays, when known; without it the cells per side are not checked here (the grid system still draws
 * no grid past the limit).
 */
export declare function gridProblem(grid: unknown, mapSize: {
    width: number;
    height: number;
} | null): string | null;
