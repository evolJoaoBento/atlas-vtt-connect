/**
 * The key light of the dice stage and the shadow it casts on the table.
 */
import * as THREE from 'three';
import type { DieAnim } from './dieMotion';
/**
 * Sets up the shadow map of a renderer every stage draws with: soft (VSM) and
 * drawn only when a stage asks for it (`StageShadow.update`).
 */
export declare function prepareShadowMap(renderer: THREE.WebGLRenderer): void;
export declare class StageShadow {
    private readonly renderer;
    private readonly canvas;
    private readonly key;
    private readonly floorMat;
    /**
     * The map no longer shows what casts it: the bodies or the light were
     * changed, or the last frame moved a body and its ghosts have yet to go.
     */
    private stale;
    /**
     * `renderer` is shared by every stage of the document (`DiceGpu`), so its
     * shadow map is asked for right before this stage draws; `canvas` is where
     * the stage is shown, whose page decides the shadow's colour.
     */
    constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, canvas: HTMLCanvasElement);
    /** Other bodies are on the stage: whatever the map holds is of the last ones. */
    bodiesChanged(): void;
    /**
     * Puts the light and its shadow frame where the camera looks: `reach` times
     * the base distance, at `focusZ` in the depth, over a stage of the given half
     * width and depth. The frame holds the **whole** stage, or a body at the wall
     * loses its shadow.
     */
    fit(reach: number, focusZ: number, halfX: number, halfZ: number): void;
    /**
     * Sets light and shadow for the frame about to be drawn. `emphasis` (0 to 1)
     * swells the light as the dice come to rest: the gleam of the result.
     *
     * **The shadow is drawn anew only when it changed.** Drawing and blurring
     * the map is most of a frame's work, and dice that lie still cast the shadow
     * they cast a frame ago: while a die waits for its push, and while the sparks
     * burn out over a landed roll, every frame drew the same map again. So the
     * map is drawn in a frame that `moved` a body, and in the one after: the
     * ghosts of a smear follow the spin, and go only once the body lies.
     */
    update(dice: readonly {
        anim: DieAnim;
    }[], emphasis: number, moved: boolean): void;
}
