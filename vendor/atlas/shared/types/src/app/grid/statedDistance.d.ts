/**
 * Distances as rulebooks and statblocks write them ("60 ft.", "18 m", "12 squares", "60'"),
 * read into a collection's game units.
 */
import type { MeasurementSettings } from './measurementFormat';
/** What a collection measures in: its unit, and how many of it one grid cell spans. */
export type GameUnit = Pick<MeasurementSettings, 'unitType' | 'unitDistance'>;
/** The units a written distance may name. */
export type StatedUnit = 'feet' | 'yards' | 'meters' | 'miles' | 'kilometers' | 'squares';
export interface StatedDistance {
    value: number;
    /** Null for a bare number. */
    unit: StatedUnit | null;
    /** Where the distance stands in the text it was read from. */
    start: number;
    end: number;
}
/**
 * The first distance `text` states, or null when it holds no number. A number written like
 * "1.000" is a thousand where `locale` (the user's, by default) groups digits with a dot; in any
 * other locale it could as well be 1, so no distance is read at all.
 */
export declare function readDistance(text: string, locale?: string): StatedDistance | null;
/**
 * A written distance in the collection's game units. A bare number and a distance in the
 * collection's own unit are taken as they are; squares count what a grid cell spans; other real
 * units are converted, and where the collection has no real unit, a rules square (5 feet) is one
 * of its grid cells.
 */
export declare function toGameUnits(distance: Pick<StatedDistance, 'value' | 'unit'>, unit: GameUnit): number;
