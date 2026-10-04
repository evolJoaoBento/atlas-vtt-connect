/**
 * **One WebGL context draws every stage of a document.**
 *
 * Each roll panel once had a context of its own. A context keeps its own copy
 * of everything it draws with: the face atlases of all six bodies (albedo and
 * relief, with their mipmaps, some 54 MB), the mirror world, the compiled
 * shaders. Four panels' worth were built ahead (`stagePool.ts`), so an idle map
 * held some 400 MB of graphics memory for dice nobody had thrown.
 *
 * Now the context is the document's and a stage is only a scene, a camera and
 * the canvas it is shown on (`DiceRenderer`). A stage draws into the bottom
 * left corner of this context's canvas and copies that corner onto its own
 * canvas in the same task, before the drawing buffer is handed on: the copy is
 * the picture, pixel for pixel, and the panel keeps its own element in the page
 * with the clipping and stacking it always had.
 */
import * as THREE from 'three';
export declare class DiceGpu {
    private readonly canvas;
    readonly renderer: THREE.WebGLRenderer;
    /** The baked reflection every stage's scene takes as its environment. */
    readonly environment: THREE.Texture;
    private readonly pmrem;
    private readonly envRT;
    /**
     * The drawing buffer in device pixels. It only grows: making drawing buffers
     * takes milliseconds, and a stage asks for its size at the moments that have
     * none to spare (a roll arriving, a roll shrinking to a row).
     */
    private size;
    /** Throws where the document has no WebGL. */
    constructor(canvas: HTMLCanvasElement);
    /**
     * Draws `scene` into the bottom left `width` × `height` device pixels and
     * copies them into the bottom left corner of `target`, which is cleared
     * first: whatever a larger view left there is not part of this frame.
     */
    draw(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number, target: CanvasRenderingContext2D): void;
    /** Gives the context back; the stages drawing with it draw nothing from then on. */
    dispose(): void;
    private reserve;
}
