/**
 * What a thrown die is painted as. Each body has its own face atlas; the d100's tens die is a d10
 * body of its own, so a dice look can print tens on it (`00` to `90`) while the units die and every
 * other d10 keep theirs. With Atlas's own looks both carry the same numerals 1 to 10.
 */
import type { DieSides } from './dieGeometry';
import type { DiePlan } from './diceScene';
/** A die type a dice look paints: the six bodies, and 100 for the tens die of a d100. */
export type DieBody = DieSides | 100;
/** Every body, tens die last. */
export declare const LOOK_BODIES: readonly DieBody[];
/** The geometry a body is built on: the tens die is a d10. */
export declare function bodySides(body: DieBody): DieSides;
/** The body a planned die is painted as. */
export declare function planBody(die: Pick<DiePlan, 'sides' | 'role'>): DieBody;
/**
 * The value a dice look's art is keyed by for the face standing for `value`. The tens die lands on
 * its face `tens || 10` (`sceneFromRolls`), so its face 10 is `00` (key 0) and face n is n × 10.
 */
export declare function artKey(body: DieBody, value: number): number;
/** The keys a dice look gives art for on `body`: 1 to its sides, and 0, 10, … 90 for the tens die. */
export declare function artKeys(body: DieBody): number[];
