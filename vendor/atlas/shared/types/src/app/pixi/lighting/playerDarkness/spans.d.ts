/**
 * Scanline geometry shared by the players' darkness and by extensions that draw fog on cells
 * (`@atlas-vtt/shared/draw`). Pure: no PIXI, Obsidian or store.
 */
/** A point in world pixels. */
interface Point {
    x: number;
    y: number;
}
/** The x ranges of a horizontal line at `y` that lie inside the polygon, by nonzero winding. */
export declare function insideSpans(points: readonly Point[], y: number): Array<[number, number]>;
export {};
