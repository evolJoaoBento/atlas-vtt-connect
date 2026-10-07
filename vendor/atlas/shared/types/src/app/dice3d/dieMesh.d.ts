/**
 * The chamfered body of each die and its material, built once per kind of die
 * and shared by every die of that kind.
 */
import * as THREE from 'three';
import { type DieBody } from './dieBody';
import { type DieSides } from './dieGeometry';
import { type ResolvedLook } from './dieSkin';
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
/** A look a die is painted in other than the active one (a collection's, `dice.useLook`), named by `key`. */
export interface LookVariant {
    /** Changes whenever `look` would paint differently. */
    key: string;
    look: () => ResolvedLook;
}
/** `look` with its body in `tint` (`#rrggbb`) and numerals that read on it; a look's art stays as it is. */
export declare function tintedLook(look: ResolvedLook, tint: string | null): ResolvedLook;
/**
 * The body painted in `variant` (null: the active look) and coloured `tint` (null: its own colour). Without either
 * it is `dieAssets(body)` itself, shared by every die of that kind. Otherwise the body shares its geometry and gets
 * its own atlas, relief and material, cached per look, body and colour (at most `MAX_VARIANTS`), redrawn with the
 * shared ones and given back with the stage pools.
 */
export declare function dieVariantAssets(body: DieBody, variant: LookVariant | null, tint: string | null): DieAssets;
/** Gives back every body painted in another look or colour: the stage pools are released. */
export declare function releaseDieVariants(): void;
export {};
