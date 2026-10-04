/** How rolls are shown: as a result card, or thrown as dice at normal or double speed. */
export type DiceDisplay = 'card' | 'fast' | 'full';
export declare const DICE_DISPLAY_OPTIONS: readonly {
    value: DiceDisplay;
    label: string;
}[];
export declare const DICE_DISPLAY_HINTS: Record<DiceDisplay, string>;
export declare function isDiceDisplay(value: unknown): value is DiceDisplay;
/** How a throw plays out. */
export interface ThrowStyle {
    /** How much faster than real time the throw plays. */
    speed: number;
    /** Most wall hits a die may make on its way; a quick throw rattles less. */
    maxWallHits: number;
}
export declare function throwStyle(display: DiceDisplay): ThrowStyle;
