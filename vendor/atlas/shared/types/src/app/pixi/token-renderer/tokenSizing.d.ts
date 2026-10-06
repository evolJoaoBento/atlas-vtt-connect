/** Stroke inset in pixels, proportional to the grid size (4px at a 70px cell). */
export declare function computeTokenStrokeWidth(gridSize: number): number;
/** Diameter in cells covered by a token of the given size multiplier. */
export declare function tokenDiameterInCells(sizeInCells: number): number;
/** Named footprints offered in menus, stored as the multiplier `tokenDiameterInCells` expects. */
export declare const TOKEN_SIZE_OPTIONS: ReadonlyArray<{
    label: string;
    size: number;
}>;
/** Size multiplier for a creature size word from statblock data ("Large", "Huge or larger"); undefined when unknown. */
export declare function tokenSizeFromCreatureSize(value: unknown): number | undefined;
/** Token sprite diameter in pixels for a token covering `sizeInCells` cells. */
export declare function computeTokenPixelSize(gridSize: number, sizeInCells: number): number;
/**
 * Scale of a token's UI (resource bars, nameplate, condition markers, +/- buttons,
 * resize and rotation handles) for a sprite `spriteSize` pixels wide. The UI lives in
 * world space and keeps its proportions to the token, so it zooms with the map and
 * never hides a small token or shrinks to nothing on a large one.
 */
export declare function tokenUIScale(spriteSize: number): number;
/** Diameter of a resize or rotate handle before `tokenUIScale`; what sits beside the token must clear it. */
export declare const RESIZE_HANDLE_SIZE = 20;
/** Height of the nameplate, which lies on the token's bottom edge, in UI units. */
export declare const NAMEPLATE_HEIGHT = 14;
/**
 * Scale of a token's bars, nameplate and condition markers while it is not selected or
 * is being dragged: a medium token's on a `gridSize` grid, whatever the token's size,
 * so the bars of huge tokens do not cover the map around them.
 */
export declare function restingTokenUIScale(gridSize: number): number;
/**
 * World scale of a selected token's bars at viewport `zoom`: a constant size on screen,
 * like map pins, so they are easy to read and click at any zoom, but never smaller than
 * the resting size (when zoomed far in).
 */
export declare function selectedTokenUIScale(restingScale: number, zoom: number): number;
