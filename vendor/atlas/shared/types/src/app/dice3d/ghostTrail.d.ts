/**
 * **Motion blur.**
 *
 * The smear is made of copies of the same pose, a few milliseconds earlier.
 * The spacing between them must **not** be measured in milliseconds: at
 * 60 rad/s twelve milliseconds are a good 40 degrees apart, and five such
 * copies are not a smear but a stack of prints. So it is measured in **angle**:
 * the chain always sweeps the same arc however fast the die spins, and only
 * gets denser.
 */
import * as THREE from 'three';
import type { DieAssets } from './dieMesh';
import type { DieAnim } from './dieMotion';
/**
 * **The chain gets shorter the fuller the hand.** Eight ghosts per die are a
 * smear for one die and, for twenty, a household of 180 meshes of which 80 go
 * into the shadow pass. A die shrunk to a fifth flying over the stage only
 * smears over a few pixels anyway: what the chain gains there in softness
 * nobody sees, and the phone pays for it all the same.
 */
export declare function chainLengthFor(dieCount: number): number;
/** One chain of ghosts per die: the motion blur of the spin. */
export declare class GhostTrail {
    private readonly scene;
    private chains;
    private materials;
    /**
     * **Ghost materials wait here between throws, they are not thrown away.**
     *
     * A ghost's material is a copy of its die's, and translucent, which makes
     * it a shader program of its own. When the last material using a program is
     * disposed, the program goes with it, and that is what every throw's end
     * did. The next throw then compiled it again on its first frame: seven
     * milliseconds, at 120 frames a second a frame lost at the very moment the
     * dice leave the hand. Kept by the die material they were copied from, the
     * copies and their program stay.
     */
    private readonly spare;
    constructor(scene: THREE.Scene);
    clear(): void;
    /** Adds the chain of the next die. Ghosts share mesh and textures, not opacity. */
    addChain(assets: DieAssets, length: number): void;
    /** The same pose a little rotation earlier. The spacing is an angle, not a time (see `SMEAR_ARC`). */
    update(index: number, body: THREE.Mesh, anim: DieAnim): void;
}
