/**
 * The numerals on the faces. Each font is a sheet of 22 cells, 6 across: the
 * numbers 1 to 20, then 6 and 9 with their underline. The medieval sheet is a
 * pencil drawing baked in the original project; the sci-fi sheet is set in
 * Oxanium at runtime in the same layout, so both are measured, fitted and
 * coloured alike.
 */
import type { DiceFont } from './diceLook';
import { type DieSides } from './dieGeometry';
export declare function loadImage(url: string): Promise<HTMLImageElement>;
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
