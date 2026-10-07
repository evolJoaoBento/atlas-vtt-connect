/**
 * Dice looks other plugins add (`dice.registerLook`): their face art replaces Atlas's numerals and
 * their colour its card, while the throw, the sounds and everything else stay Atlas's. Kept here by
 * full id (`<extension id>:<look id>`), checked and guarded before they arrive; which one is in
 * effect is the settings' choice (`diceLookSync`).
 */
import type { DieBody } from './dieBody';
/** One face's art: an image, or a URL Atlas loads (`data:`, `blob:`, `https:` with CORS). */
export type FaceArtSource = CanvasImageSource | string;
export type FaceArtSet = Readonly<Record<number, FaceArtSource>>;
/** A registered look as Atlas keeps it. Its object is new for each registration, so its art is loaded once per registration. */
export interface CustomDiceLook {
    /** `<extension id>:<look id>`. */
    readonly id: string;
    readonly name: string;
    /** The face art of one body, by `artKeys(body)`; may throw or reject, which paints Atlas's numerals instead. */
    faces(body: DieBody): Promise<FaceArtSet>;
    /** The relief of one body's faces; without it a face's art is pressed in as Atlas's numerals are. */
    bump?: (body: DieBody) => Promise<FaceArtSet>;
    /** The card's colour (`#rrggbb`); null keeps Atlas's card stock. */
    readonly body: string | null;
    /** The colour of the numerals Atlas paints where the look has no art (`#rrggbb`); null picks one that reads on the body. */
    readonly ink: string | null;
    /** An image of the look for the settings, a URL. */
    readonly preview: string | null;
    /** `face`: a face's art covers its whole cell, without Atlas's card, numeral and wear; unset draws it where the numeral goes. */
    readonly fill?: 'face';
}
/** Adds `look`; the returned function removes this registration (and nothing registered after it under the same id). */
export declare function addCustomLook(look: CustomDiceLook): () => void;
export declare function customLook(id: string): CustomDiceLook | null;
/** The registered looks, in the order they were added. */
export declare function customLooks(): readonly CustomDiceLook[];
/** Hears every registration and removal; returns the stop. */
export declare function onCustomLooksChange(listener: () => void): () => void;
