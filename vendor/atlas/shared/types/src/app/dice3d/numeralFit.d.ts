/**
 * How large a numeral may be on its face.
 *
 * Numerals used to be sized per kind of die, as a share of the atlas cell.
 * That fits squares and pentagons, but a triangle has little room towards its
 * edges and a d10's kite even less, so wide numbers ("14", an underlined "6")
 * ran over the edge onto the chamfer. Here each numeral is fitted to its own
 * face: its ink is centred on the face centre and shrunk only as far as it has
 * to be to stay inside with a margin. It is never enlarged, so numerals that
 * fitted keep their size.
 *
 * It is never moved either. Sliding wide numerals to where the face is widest
 * kept them larger, but on a triangle that is its base: "20" sat low on its
 * face beside a centred "7", and the die looked misprinted.
 */
/** Ink bounds of a numeral in its sheet cell, in sheet pixels, y down. */
export interface InkBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
/**
 * The factor on a numeral's nominal size, at most 1, at which its ink,
 * `inkWidth` by `inkHeight` cell pixels at nominal size and centred on the face
 * centre, stays inside the face `outline` (cell pixels around the face centre)
 * within the margin.
 */
export declare function fitNumeral(outline: readonly (readonly [number, number])[], inkWidth: number, inkHeight: number): number;
