/**
 * The colour of the dice, as painted into their face atlas: the ground of each
 * cell, its worn rim and the colour of the numerals. The light dice are the
 * card stock as it is; dark and accent dice lay a colour under the card's grain,
 * so the faces keep their paper texture in any colour.
 */
import type { LookArt } from './customLookArt';
import type { CustomDiceLook } from './customLooks';
import { type DiceColour, type DiceFont, type DiceLook, type Rgb } from './diceLook';
/** A look with its colours worked out for painting. */
export interface ResolvedLook {
    colour: DiceColour;
    font: DiceFont;
    /** The body colour; null keeps the card stock's own tone. */
    body: string | null;
    /** The numeral colour; null keeps the pencil sheet's graphite. */
    ink: string | null;
    /** The full id of the extension's dice look in effect (`customLooks`); null for Atlas's own. */
    lookId: string | null;
    /** That look's face art, painted where it has some; null for Atlas's own look. */
    art: LookArt | null;
}
export declare function activeLook(): ResolvedLook;
export declare function setActiveLook(look: ResolvedLook): void;
/** The colours of a look; `accent` is Obsidian's accent colour where the look needs it. */
export declare function resolveLook(look: DiceLook, accent: Rgb | null): ResolvedLook;
/**
 * An extension's look with its art: its body colour (the card stock without one), and for faces it has no art for,
 * Atlas's numerals in the user's font and the look's ink, or the ink that reads on its body.
 */
export declare function resolveCustomLook(look: DiceLook, custom: Pick<CustomDiceLook, 'id' | 'body' | 'ink'>, art: LookArt): ResolvedLook;
/**
 * The ground of a face: a cut from the card stock, taken from a different spot
 * per cell. The same cut on twenty faces would look stamped, precisely when
 * the die turns. A coloured body lies under the cut, which then only lends it grain.
 */
export declare function paintCard(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number, card: HTMLImageElement | null, look: ResolvedLook): void;
/**
 * **The worn rim.**
 *
 * A die that spent a long time in a bag is darker at the edges than in the
 * face: that is where the hand grips and where it knocks against its
 * neighbours. Without this gradient every face is evenly bright and the body
 * looks freshly pressed: clean, and therefore wrong.
 *
 * The cell is darkened radially, and that fits the face although it is a
 * triangle or pentagon: the polygon sits centred in its cell, so its rim lies
 * wherever the gradient turns dark. The last cell (chamfers and corners) gets
 * more of it than the faces, because the edges are what gets knocked. Card
 * darkens brown; a coloured body darkens towards black.
 */
export declare function paintWear(ctx: CanvasRenderingContext2D, x: number, y: number, edge: boolean, look: ResolvedLook): void;
