/**
 * How Atlas lays out a map text, read by `TextRenderer`; pure,
 * no PIXI imports. A text is centred on its position. A background, when set, is the
 * text's measured box grown by its padding (8 when unset or 0) and filled at the text's
 * opacity; the glyphs themselves stay opaque. Atlas sizes the box to the text: `width`
 * and `height` are not used for drawing.
 */
export declare const DEFAULT_TEXT_PADDING = 8;
/** Line spacing in font sizes, for surfaces that cannot measure the font; part of the shared drawing contract (`@atlas-vtt/shared/draw`). */
export declare const TEXT_LINE_SPACING = 1.2;
export interface TextBoxSource {
    backgroundColor?: string | null | undefined;
    padding?: number | null | undefined;
    borderRadius?: number | null | undefined;
    opacity?: number | null | undefined;
}
/** The text's measured box around its centre. */
export interface TextBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface TextBackground extends TextBounds {
    color: string;
    /** 0 for square corners. */
    radius: number;
    alpha: number;
}
export declare function textBackground(text: TextBoxSource, bounds: TextBounds): TextBackground | null;
export declare function textFontWeight(text: {
    bold?: boolean | null | undefined;
}): 'bold' | 'normal';
export declare function textFontStyle(text: {
    italic?: boolean | null | undefined;
}): 'italic' | 'normal';
/** The text's rotation in radians; stored in degrees. */
export declare function textRotation(rotation: number | null | undefined): number;
export declare function textScale(scale: number | null | undefined): number;
