import type { DiceFont } from './diceLook';
import { type DieSides } from './dieGeometry';
import { type NumeralMark } from './faceMarks';
/** Loads an image; `anonymous` asks for CORS, so a cross-origin image that allows it can be painted into a die's atlas. */
export declare function loadImage(url: string, anonymous?: boolean): Promise<HTMLImageElement>;
/**
 * Makes the numeral sheet of a font ready, once. If it fails the dice keep
 * blank faces: ugly, but it does not hold up the throw.
 */
export declare function loadNumerals(font: DiceFont): Promise<void>;
/** Whether the numeral sheet of a font is loaded. */
export declare function numeralsReady(font: DiceFont): boolean;
/** Font size of the numeral per body: many faces means little room, and the d4 writes three on each face. */
export declare function numeralSize(sides: DieSides): number;
/** The 6 and the 9 carry an underline where both occur on the body. */
export declare function needsUnderline(sides: DieSides, value: number): boolean;
/** Which cell of the sheet carries this number; underlined 6 and 9 sit at the end. */
export declare function numeralCell(sides: DieSides, value: number): number;
/**
 * The numerals of the face that stands for `value` (`faceMarks`), from the
 * font's sheet: each fitted into its room, its ink centre on its place, and
 * coloured `ink` (null: as drawn).
 */
export declare function paintNumeral(ctx: CanvasRenderingContext2D, x: number, y: number, sides: DieSides, value: number, font: DiceFont, ink: string | null): void;
/** One numeral of a face (`faceMarks`), in the cell centred on `x`, `y`: a d4 face carries three. */
export declare function paintNumeralMark(ctx: CanvasRenderingContext2D, x: number, y: number, sides: DieSides, mark: NumeralMark, font: DiceFont, ink: string | null): void;
