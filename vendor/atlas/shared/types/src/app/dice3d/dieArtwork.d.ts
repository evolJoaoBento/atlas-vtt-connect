/**
 * The faces of the dice: cut from card stock and lettered in pencil.
 *
 * A computed wood grain used to live here: fractal growth rings in the albedo,
 * the same strokes as grooves in the relief, numerals from `fillText` in gold
 * with a darker rim. It looked expensive and was the only thing on the sheet
 * that came out of a drawing program; next to it every glyph, every card and
 * the title itself is a pencil stroke.
 *
 * Both now come baked (`tools/pencil-die-faces.mjs` in the original project):
 * the numerals as drawings on the same net as everything else, the ground as a
 * cut from the same paper layer that lies under the whole sheet. The only thing
 * computed here is **which numeral goes into which cell**.
 *
 * The images arrive later: until they do, the body shows the bare card tone,
 * and `dieAssets` redraws the faces once they are there.
 */
import * as THREE from 'three';
import type { DiceFont } from './diceLook';
import { type DieBody } from './dieBody';
import { type DieSides } from './dieGeometry';
/** Whether faces painted now would have their card stock and the numerals of `font`. */
export declare function diceArtworkReady(font: DiceFont): boolean;
/**
 * Fetches the card stock and the numeral sheet of a font, once each, in the
 * background. If it fails the die stays a piece of card without numbers: ugly,
 * but it does not hold up the throw.
 */
export declare function loadDiceArtwork(font?: DiceFont): Promise<void>;
/**
 * Paints the numerals of a body into a drawing atlas. `paint` gets the cell
 * centre in pixels per face and paints ground and numeral; the last cell stays
 * the blank ground for chamfers and corners.
 */
export declare function drawAtlas(sides: DieSides, paint: (ctx: CanvasRenderingContext2D, cell: {
    x: number;
    y: number;
    value: number | null;
}) => void): HTMLCanvasElement;
export interface DieTextures {
    map: THREE.CanvasTexture;
    bumpMap: THREE.CanvasTexture;
    redraw: () => void;
}
/**
 * The atlas of a body: one cell per face holding card and numeral (or a dice
 * look's art, `faceArt.ts`); the tens die of a d100 has its own. The last
 * cell stays bare card; it carries the chamfers and corners.
 *
 * Plus a relief. It comes from **the same two images**: the paper's grain is
 * the tooth, and where graphite lies it lies *in* the tooth, a touch deeper.
 * Randomised separately, the relief would look like scratches on a photo of
 * paper.
 */
export declare function buildTextures(body: DieBody): DieTextures;
