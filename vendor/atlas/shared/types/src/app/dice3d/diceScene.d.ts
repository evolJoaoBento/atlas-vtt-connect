/**
 * Which rolled dice can be shown as a real *body*, and which cannot.
 *
 * There are five platonic solids and the pentagonal trapezohedron; the world
 * has no other real dice. A d13 still rolls, it just gets no stage: a die with
 * thirteen faces would be a lie.
 *
 * Justified exception: **d100** is two d10s, tens and units, with the printed
 * rule `00 + 0 = 100`.
 *
 * Second justified exception: **d2 and d3** have no body either, and the usual
 * table rule says how to roll them on a d6 whose faces are grouped: for a d2,
 * 1–3 is one and 4–6 is two; for a d3, 1–2 is one, 3–4 two, 5–6 three.
 */
import type { RolledDie } from '../tools/diceFormula';
import type { DieSides } from './dieGeometry';
export declare const DIE_BODIES: DieSides[];
export type DieRole = 'plain' | 'tens' | 'units';
export interface DiePlan {
    sides: DieSides;
    role: DieRole;
    /**
     * The body mimics a smaller die: the landed face is divided by this number
     * and rounded up. Without it the face counts as is.
     */
    fold?: number;
    /**
     * The die was rolled because the die at this place in the plan exploded: it
     * is thrown only once that die has landed.
     */
    follows?: number;
    /** The die of an explosion downwards: it subtracts. */
    subtracts?: true;
}
export interface DiceScene {
    plan: DiePlan[];
    /** Face each die lands on, in plan order. */
    faces: number[];
}
/** Whether a rolled die shows a face it has: a whole number from 1 to its sides, which are a whole number above 0. */
export declare function landsOnAFace(die: Pick<RolledDie, 'max' | 'value'>): boolean;
/**
 * The stage for Atlas' rolled dice, or null when they cannot all be shown as
 * real bodies.
 *
 * Subtracted dice are rejected: on the stage they would be a die whose pips
 * have to be subtracted without that being visible. The die of an explosion
 * downwards is the exception: the die before it bursts as a failure and the
 * die is thrown for it alone, which says what it does. A percentile roll only
 * stands alone, because its tens and units are read by their place.
 *
 * A mimicked die lands on the highest face of its band (a d2's 2 shows the
 * d6's 6), so the face always reads back as the value everyone sees.
 */
export declare function sceneFromRolls(rolls: readonly Pick<RolledDie, 'max' | 'value' | 'negative' | 'exploded'>[]): DiceScene | null;
/** How many dice the longest chain of explosions throws after its first die; 0 when nothing exploded. */
export declare function chainDepth(plan: readonly DiePlan[]): number;
/**
 * Positions in world coordinates and the matching radius. The dice stand in a
 * grid whose aspect follows the stage's, each moving close enough that the
 * grid just fills the stage.
 *
 * **The row count is rounded, not rounded up.** Rounded up, two dice would get
 * two rows of one, and a handful of dice would become a column. Rounded, the
 * layouts are the ones people lay out at the table: two and three side by
 * side, four as a square, twenty as five by four.
 */
export declare function layoutDice(count: number): {
    offsets: [number, number][];
    radius: number;
};
export interface RestingFrame {
    /** Half the width of table the view shows. */
    halfWidth: number;
    /** Width over height of the field that shows it. */
    aspect: number;
}
/**
 * The view that frames only the resting dice of a layout, for a shrunk roll:
 * its small field would show the dice as specks if it framed the whole stage.
 * The field takes the shape of the layout (square for one die, wide for a row
 * of dice, up to `MAX_FIELD_ASPECT`), and the view reaches just past the
 * furthest die edge in both directions.
 */
export declare function restingFrame(offsets: readonly (readonly [number, number])[], radius: number): RestingFrame;
