/** The laser pointer's look, kept in Atlas' settings so it follows the GM to every map. */
export interface LaserPointerSettings {
    color: string;
    /** Radius of the glow around the pointer, in screen pixels at any zoom. */
    size: number;
}
/**
 * The hue families of the Okabe-Ito colour-blind-safe palette, brightened into laser
 * colours and tuned so no two swatches look alike with protanopia, deuteranopia or
 * tritanopia (checked by simulation: every pair at least 10 ΔE2000 apart). Sky blue,
 * blue and white stay vivid for every kind of colour blindness.
 */
export declare const LASER_COLOR_SWATCHES: readonly [{
    readonly value: "#ff0059";
    readonly label: string;
}, {
    readonly value: "#ff9f2e";
    readonly label: string;
}, {
    readonly value: "#fff133";
    readonly label: string;
}, {
    readonly value: "#66ffa9";
    readonly label: string;
}, {
    readonly value: "#00a9ff";
    readonly label: string;
}, {
    readonly value: "#3d6bff";
    readonly label: string;
}, {
    readonly value: "#e85aa8";
    readonly label: string;
}, {
    readonly value: "#ffffff";
    readonly label: string;
}];
/** Shown with the swatches, since colour-blind players cannot tell which ones work for them. */
export declare const LASER_COLOR_HINT: string;
export declare const LASER_SIZE_MIN = 8;
export declare const LASER_SIZE_MAX = 100;
export declare const DEFAULT_LASER_POINTER_SETTINGS: LaserPointerSettings;
/** How long a point of the trail stays visible, in milliseconds. */
export declare const LASER_FADE_TIME = 800;
/** Stored settings, with anything unusable (hand edits, older files) replaced by the default. */
export declare function resolveLaserPointerSettings(raw: Partial<LaserPointerSettings> | undefined): LaserPointerSettings;
