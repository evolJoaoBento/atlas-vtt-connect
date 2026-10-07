/**
 * The art of a dice look another plugin added, made ready to paint: asked for once per
 * registration, each face copied into a canvas of Atlas's own no larger than a face cell. A face
 * whose art is missing, fails, arrives late, is too large or would taint the atlas (a cross-origin
 * image without CORS, which WebGL then refuses to upload for every die of its kind) is left out,
 * and Atlas paints its own numeral there: a look never breaks a die. A face with art shows the art
 * and no numeral of Atlas's (`paintFaceMarks`). One console line per look names every face that
 * falls back and why; art that arrives after its 10 s is still taken in and painted (`onLateLookArt`).
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
/** How long Atlas still waits for a body's art that missed its 10 s; it is painted once it arrives. */
export declare const LATE_LOOK_ART_MS = 120000;
/** Hears a look's art for a body arriving after its 10 s, by then in its `LookArt`; returns the stop. */
export declare function onLateLookArt(listener: (look: CustomDiceLook) => void): () => void;
/** The art of `look`, asked for and loaded once per registration; never rejects. */
export declare function lookArt(look: CustomDiceLook): Promise<LookArt>;
