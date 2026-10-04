export interface UiRect {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** Gap between the token's edge and the first bar. */
export declare const FIRST_BAR_GAP = 2;
/** The bars' thin outer stroke; their dark inside starts at its inner edge. */
export declare const BAR_BORDER = 0.75;
/** A bar's fill sits this far inside its dark inside, so it looks contained. */
export declare const BAR_FILL_INSET = 1;
/** Tick marks every tenth of a bar. */
export declare const BAR_TICKS = 10;
export declare const BAR_STYLE: {
    readonly border: 8947848;
    readonly inside: 1710618;
    readonly tick: 3355443;
    readonly tickAlpha: 0.5;
    readonly tickWidth: 0.5;
    /** Darkens the bar whose spending defeats the token. */
    readonly defeatedAlpha: 0.4;
};
export declare const NAMEPLATE: {
    readonly fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Arial";
    /** The text is set at this size and scaled by `textScale`, so it stays crisp when zoomed. */
    readonly fontSize: 24;
    readonly fontWeight: "600";
    readonly textScale: 0.333;
    readonly textAlpha: 0.85;
    readonly padding: 6;
    readonly minWidth: 40;
    readonly height: 14;
};
export declare const NAMEPLATE_STYLE: {
    readonly dark: {
        readonly fill: 2763306;
        readonly border: 16777215;
        readonly borderAlpha: 0.4;
    };
    readonly light: {
        readonly fill: 14935011;
        readonly border: 0;
        readonly borderAlpha: 0.3;
    };
    readonly borderWidth: 0.5;
    readonly text: 16777215;
};
/** The rectangles of `count` bars stacked under the token, each `barDimensions.token` sized and centred, the first `FIRST_BAR_GAP` below it. */
export declare function barStackRects(count: number): UiRect[];
/** A bar's dark inside, which starts at the inner edge of its border. */
export declare function barInnerRect(bar: UiRect): UiRect;
/** A bar's fill, inside its dark background. */
export declare function barFillRect(inner: UiRect): UiRect;
/** The x of each tick mark inside a bar. */
export declare function barTickXs(inner: UiRect): number[];
/**
 * The nameplate's badge for a name `textWidth` wide at `NAMEPLATE.fontSize`, centred,
 * its bottom edge on the token's bottom edge; `textY` is where the text's middle goes.
 */
export declare function nameplateRect(textWidth: number): UiRect & {
    textY: number;
};
