/**
 * **Sparks** over the throw.
 *
 * This used to be a `THREE.PointsMaterial`. Without a texture it draws
 * **squares**: nobody notices with eight points, with sixty it looks like paper
 * confetti. Sparks are round, white inside and nothing outside. That is not an
 * image but a formula, and it lives in the fragment shader below.
 *
 * A single point cloud carries every spark on the stage: the spray at a wall,
 * the shower on landing, the fireworks of a top roll. A dead spark gets size
 * zero and costs nothing more. So nothing is built in the middle of a throw,
 * where a hitch would be exactly where everyone is looking.
 */
import * as THREE from 'three';
import type { Vec3 } from './vectorMath';
export interface SparkBurst {
    count: number;
    at: Vec3;
    /** Main direction of the spray cone. */
    dir: Vec3;
    /** 0 is a beam, 1 a sphere. */
    spread: number;
    speed: number;
    /**
     * How hard the air brakes. **The real control for the reach**: a spark
     * travels about `speed / drag`, however long it lives.
     */
    drag?: number;
    /**
     * How far from the origin the sparks are **born**. Born from one point they
     * look like a blob in the first moment; born from a shell they are a cloud
     * from the start.
     */
    shell?: number;
    /** Lifetime in seconds, scattered upwards. */
    life: number;
    size: number;
    /** Two colours, the hot core and the cold ash, mixed per spark. */
    hot: THREE.ColorRepresentation;
    cool: THREE.ColorRepresentation;
    gravity: number;
}
export declare class Sparks {
    private readonly floorY;
    private readonly points;
    private readonly scale;
    private readonly position;
    private readonly size;
    private readonly tint;
    private readonly fade;
    private readonly velocity;
    private readonly age;
    private readonly life;
    private readonly size0;
    private readonly tint0;
    private readonly drag;
    private readonly gravity;
    /** Where the next spark is written: the ring buffer. */
    private next;
    private alive;
    constructor(scene: THREE.Scene, floorY: number);
    /** Viewport height and field of view change the conversion; both come from outside. */
    setViewport(heightPx: number, fovDegrees: number): void;
    emit(burst: SparkBurst): void;
    /** Whether any spark still glows. */
    get burning(): boolean;
    step(dt: number): void;
    /**
     * All glow off at once. For a stage handed on to the next throw: its first
     * frame must not inherit the previous throw's sparks. An age beyond any
     * lifetime means "dead" everywhere.
     */
    clear(): void;
}
