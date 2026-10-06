/**
 * The dice renderer: **real light instead of computed tones.**
 *
 * A software version painted every face with a gradient and a formula
 * highlight; it read as cardboard, not as a die. What gives a die its look
 * cannot be painted per face:
 *
 * 1. **Reflections of the surroundings.** A studio environment
 *    (`RoomEnvironment`) stands behind the material as its mirror world.
 * 2. **The chamfer as a body.** The edge is really ground off: a narrow strip
 *    of geometry that catches the light differently from the face, anew at
 *    every turn (`dieMesh.ts`).
 * 3. **The cut numeral.** A bump map sinks the number into the material.
 * 4. **A real cast shadow.** The die casts it on the table, with a soft edge,
 *    in its own shape; no blob underneath.
 *
 * The math stays where it is: `dieGeometry.ts` supplies the bodies,
 * `dieMotion.ts` the path. This file only draws, through the document's one
 * WebGL context (`DiceGpu`), onto the stage's own canvas.
 */
import type { DiceGpu } from './DiceGpu';
import type { DieSides } from './dieGeometry';
import type { DieBody } from './dieBody';
import type { DieAnim } from './dieMotion';
import { type Crit } from './impactSparks';
export interface StageDie {
    anim: DieAnim;
    sides: DieSides;
    /** Rolled for an explosion: not on the table until it is thrown. */
    waits?: boolean;
    /** The die exploded: it lands with this burst, whatever the roll as a whole is. */
    burst?: Crit;
}
/** The pixel ratio a stage in `win` is drawn at: beyond 2 nobody sees the difference, and it is paid on every frame. */
export declare function stagePixelRatio(win: Window): number;
export declare class DiceRenderer {
    private readonly gpu;
    private readonly canvas;
    private readonly scene;
    private readonly view;
    private readonly shadow;
    /** Where the frames are shown; null where the document has no 2D canvas. */
    private readonly output;
    private meshes;
    private readonly trails;
    private readonly sparks;
    /** Who has landed already: the landing fires only once. */
    private landed;
    private lastTime;
    /** The canvas' size in CSS pixels and its pixel ratio. */
    private buffer;
    /** What a frame draws, in device pixels: the canvas' bottom left corner. */
    private viewport;
    /** `canvas` is this stage's own, shown on its panel; `gpu` draws for every stage of its document. */
    constructor(gpu: DiceGpu, canvas: HTMLCanvasElement);
    /**
     * One mesh per planned die; dice of the same kind share geometry and
     * material. Each gets a chain of ghosts, shorter the more dice there are
     * (`chainLengthFor`).
     */
    setPlan(bodies: readonly DieBody[]): void;
    /** The stage as the throw knows it: half width and half depth in world units. */
    stage(): readonly [number, number];
    /**
     * Sizes the canvas to exactly this and fits the camera: to `halfWidth` world
     * units either side of the centre, by default the whole stage the dice bounce
     * around in.
     */
    setSize(width: number, height: number, dpr: number, focus?: number, halfWidth?: number): void;
    /**
     * `setSize` for a stage on a panel: draws at this size in the bottom left
     * corner of a canvas that is at least as large, and keeps the canvas.
     *
     * Making drawing buffers takes milliseconds, and a panel asked for them at
     * the two moments that have none to spare: when its roll arrives, and when
     * the next roll shrinks it to a row. So a canvas only ever grows; the stage
     * holds it by that corner and clips the rest (`.atlas-dice-roll__stage`).
     */
    setView(width: number, height: number, dpr: number, focus?: number, halfWidth?: number): void;
    /** Gives the canvas this size, as an element and in pixels, unless it has it. */
    private allocate;
    /**
     * Draws at this size in the canvas' bottom left corner and fits the camera,
     * the key light and its shadow frame to it.
     */
    private fitView;
    /** One frame: take the poses from the simulation and draw. */
    render(dice: StageDie[], emphasis: number, crit?: Crit): void;
    /**
     * Whether the next frame would show what the last one did, the dice being at
     * rest: no spark burns and the camera stands. The stage's clock stops there.
     */
    isStill(): boolean;
    /** Shakes the camera by the strongest wall hit of this frame. */
    private placeCamera;
    /**
     * **The stage is cleared, not torn down.**
     *
     * There once was a `dispose()` here that gave the WebGL context back with
     * `forceContextLoss()`, because every throw built its own stage. The idea was
     * right, the effect was not: an abandoned context **keeps counting** until
     * garbage collection gets round to it. Measured in WebKit, twenty throws in
     * a row: from the seventeenth on, every single one logged "There are too many
     * active WebGL contexts on this page, the oldest context will be lost". On a
     * phone the series does not end with a warning but with the system reloading
     * the page under memory pressure, mid-game.
     *
     * A stage now holds no context at all (`DiceGpu` is the document's), and it
     * is still cleared and handed on to the next throw (`stagePool.ts`): its
     * scene, shadow map and canvas are ready for it.
     */
    reset(): void;
}
