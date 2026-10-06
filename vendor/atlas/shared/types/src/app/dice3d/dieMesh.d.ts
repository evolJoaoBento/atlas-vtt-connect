/**
 * The chamfered body of each die and its material, built once per kind of die
 * and shared by every die of that kind.
 */
import * as THREE from 'three';
import { type DieBody } from './dieBody';
import { type DieSides } from './dieGeometry';
export interface DieAssets {
    geometry: THREE.BufferGeometry;
    material: THREE.MeshPhysicalMaterial;
    redraw: () => void;
}
type Uv = [number, number];
/** Centre of atlas cell `index` in UV coordinates (V points up). */
export declare function cellCenter(sides: DieSides, index: number): Uv;
/**
 * The body with chamfers: every face is pulled in a little towards its
 * centroid, and the gaps between are filled with narrow strips (edges) and
 * small caps (corners). All unindexed, so `computeVertexNormals` yields exactly
 * the hard facets a ground edge needs. A real bevel catches the light
 * differently from the face at every turn, where a lighter tone would not.
 */
export declare function chamferedGeometry(sides: DieSides): THREE.BufferGeometry;
export declare function dieAssets(body: DieBody): DieAssets;
/** Redraws the faces of every cached body, or of one: when the artwork arrives or the look changes. */
export declare function refreshDieArtwork(body?: DieBody): void;
export {};
