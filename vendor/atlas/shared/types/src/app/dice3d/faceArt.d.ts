/**
 * What a face cell carries: Atlas's numerals, or a dice look's art where it has some. Art goes
 * where the numeral would: centred on the numeral's place, upright as it reads, and as large as
 * the face lets it be within the numeral's margin (`fitNumeral`). On a d4 each of a face's three
 * corner numbers is its own mark, so its art is painted three times per face, turned to its corner.
 */
import { type DieBody } from './dieBody';
import type { ResolvedLook } from './dieSkin';
/**
 * A `fill: 'face'` look's face: its art over the whole cell, on the look's body colour where the art is transparent,
 * and nothing of Atlas's. False (nothing painted) for any other look or a face it has no art for.
 */
export declare function paintFaceFill(ctx: CanvasRenderingContext2D, x: number, y: number, body: DieBody, value: number, look: ResolvedLook): boolean;
/** The relief of such a face: the look's relief art over the whole cell, else none (flat). False for any other face. */
export declare function paintFaceFillRelief(ctx: CanvasRenderingContext2D, x: number, y: number, body: DieBody, value: number, look: ResolvedLook): boolean;
/** The bare cell (chamfers and corners) of a `fill: 'face'` look with a body colour: that colour alone, so the edges match its faces. */
export declare function paintBareFill(ctx: CanvasRenderingContext2D, x: number, y: number, look: ResolvedLook): boolean;
/**
 * The marks of the face of `body` that stands for `value`: a look's art for its key where it has
 * some, Atlas's numeral (in `look`'s font and ink) everywhere else.
 */
export declare function paintFaceMarks(ctx: CanvasRenderingContext2D, x: number, y: number, body: DieBody, value: number, look: ResolvedLook): void;
/**
 * The relief of the same marks, drawn dark into the tooth: a look's relief art as given (grey),
 * else its face art's silhouette, else Atlas's numeral, as Atlas presses its own numerals in.
 */
export declare function paintFaceRelief(ctx: CanvasRenderingContext2D, x: number, y: number, body: DieBody, value: number, look: ResolvedLook): void;
