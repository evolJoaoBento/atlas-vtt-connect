/**
 * The art of a dice look another plugin added, made ready to paint: asked for once per
 * registration, each face copied into a canvas of Atlas's own no larger than a face cell. A face
 * whose art is missing, fails, arrives late, is too large or would taint the atlas (a cross-origin
 * image without CORS, which WebGL then refuses to upload for every die of its kind) is left out,
 * and Atlas paints its own numeral there: a look never breaks a die.
 */
import type { CustomDiceLook } from './customLooks';
import { type DieBody } from './dieBody';
/** How long one body's art may take, `faces()` and every image of it together. */
export declare const LOOK_ART_TIMEOUT_MS = 10000;
/** The largest side of an image Atlas takes for a face; larger is left out rather than decoded into memory again. */
export declare const MAX_FACE_IMAGE_SIDE = 8192;
/** Ready art by body and key (`artKeys`). */
export type BodyArt = ReadonlyMap<DieBody, ReadonlyMap<number, HTMLCanvasElement>>;
export interface LookArt {
    faces: BodyArt;
    /** Relief by body and key; a face without it is pressed in from its `faces` art. */
    bump: BodyArt;
}
/** `source` drawn into a canvas of Atlas's own, at most a cell on its longer side; null when it cannot be taken. */
export declare function copyFaceImage(source: CanvasImageSource): HTMLCanvasElement | null;
/** The art of `look`, asked for and loaded once per registration; never rejects. */
export declare function lookArt(look: CustomDiceLook): Promise<LookArt>;
