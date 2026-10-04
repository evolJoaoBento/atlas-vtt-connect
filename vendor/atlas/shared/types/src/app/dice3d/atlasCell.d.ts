/** The face atlas of a die: one square cell per face, plus a blank one for chamfers and corners. */
import type { DieSides } from './dieGeometry';
/** Edge length of an atlas cell in pixels. */
export declare const CELL = 256;
/** Small seeded random generator: same seed, same sequence. */
export declare function seededRandom(seed: number): () => number;
/** One atlas cell per face plus a blank one for chamfers and corners. */
export declare function atlasLayout(sides: DieSides): {
    cols: number;
    rows: number;
};
