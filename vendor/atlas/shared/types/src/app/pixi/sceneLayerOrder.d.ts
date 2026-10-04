/**
 * The order Atlas stacks a scene's layers in, bottom first. The map and the grid sit
 * at the bottom by child index (the map at 0, the grid just above it); the others by
 * `zIndex`. Pure, with no PIXI imports.
 */
export declare const SCENE_LAYER_ORDER: readonly ["map", "grid", "tokens", "texts", "drawings", "fog"];
export type SceneLayer = typeof SCENE_LAYER_ORDER[number];
/** `zIndex` in the viewport of the layers placed by it. */
export declare const SCENE_LAYER_Z: {
    readonly tokens: 0;
    readonly texts: 500;
    /** Above tokens and texts, below fog so hidden areas stay hidden. */
    readonly drawings: 900;
    readonly fog: 1000;
};
