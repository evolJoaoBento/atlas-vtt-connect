/** How the dice look: the colour of their body and the face of their numerals. */
/** `light` is card stock with graphite numerals, `dark` the reverse, `accent` Obsidian's accent colour. */
export type DiceColour = 'light' | 'dark' | 'accent';
/** `medieval` is the pencil-drawn numeral sheet, `scifi` numerals set in Oxanium. */
export type DiceFont = 'medieval' | 'scifi';
export interface DiceLook {
    colour: DiceColour;
    font: DiceFont;
}
export declare const DEFAULT_DICE_LOOK: Readonly<DiceLook>;
export declare const DICE_COLOUR_OPTIONS: readonly {
    value: DiceColour;
    label: string;
}[];
export declare const DICE_FONT_OPTIONS: readonly {
    value: DiceFont;
    label: string;
}[];
export declare function isDiceColour(value: unknown): value is DiceColour;
export declare function isDiceFont(value: unknown): value is DiceFont;
export type Rgb = readonly [number, number, number];
/** Numerals on a dark body. */
export declare const LIGHT_INK = "#e2e8f0";
/** Numerals on a light body, where no pencil drawing supplies its own tone. */
export declare const DARK_INK = "#1c1714";
/** The numeral colour that reads best on a body of this colour: dark ink on light bodies, light ink otherwise. */
export declare function readableInk(body: Rgb): string;
/** `#rrggbb` to channels; null for anything else. */
export declare function parseHex(hex: string): Rgb | null;
