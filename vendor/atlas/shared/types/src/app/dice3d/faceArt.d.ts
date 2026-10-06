/**
 * What a face cell carries: Atlas's numerals, or a dice look's art where it has some. Art goes
 * where the numeral would: centred on the numeral's place, upright as it reads, and as large as
 * the face lets it be within the numeral's margin (`fitNumeral`). On a d4 each of a face's three
 * corner numbers is its own mark, so its art is painted three times per face, turned to its corner.
 */
import { type DieBody } from './dieBody';
import type { ResolvedLook } from './dieSkin';
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
