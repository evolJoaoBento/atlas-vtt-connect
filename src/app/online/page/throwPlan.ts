/**
 * How the join page throws a roll: upstream's `DiceStage` (`react/components/dice3d/DiceStage.tsx`)
 * without React, for the steps that decide where the dice go. The same seeded streams in the same
 * order (`throwRandom(seed, -1 - i)` for each body, `1000 + i` for its jolts in flight, `2000 + i`
 * for its resting turn, `i` for its launch), so a roll thrown on the page lands as it does in the
 * Obsidian Online scene, which uses `DiceStage` itself. `tests/unit/online/throwPlan.test.ts` holds
 * the two together. Imports no three.js: the page loads that only with the first throw.
 */
import type { StageDie } from '@atlas-vtt/shared/dice3d';
import { layoutDice, type DiceScene } from '@atlas-vtt/shared/dice3d';
import type { ThrowStyle } from '@atlas-vtt/shared/dice3d';
import { dieGeometry, faceIndexForValue, lyingHeight, REST_YAW, restingQuaternion } from '@atlas-vtt/shared/dice3d';
import { makeDie, restImmediately } from '@atlas-vtt/shared/dice3d';
import type { Rng } from '@atlas-vtt/shared/dice3d';
import { beginThrow, burstOf } from '@atlas-vtt/shared/dice3d';
import { throwRandom } from '@atlas-vtt/shared/dice3d';

export interface PlannedThrow {
  dice: StageDie[];
  /** Each die's randomness while it flies. */
  stepRandoms: Rng[];
}

export interface ThrowStage {
  /** The stage's walls before the view is measured: `DiceStage` makes its dice then. */
  before: readonly [number, number] | undefined;
  /** Measures the view and gives its walls, which the dice take while they lie still. */
  measure(): readonly [number, number] | undefined;
}

/**
 * The dice of a roll on their stage, launched (or laid on their faces at once with reduced
 * motion), in `DiceStage`'s order: bodies, then the measured walls, then the targets and launch.
 */
export function planThrow(scene: DiceScene, seed: string, stage: ThrowStage, style: ThrowStyle, reduced: boolean): PlannedThrow {
  const { offsets, radius } = layoutDice(scene.plan.length);
  const dice: StageDie[] = scene.plan.map((die, i) => ({
    anim: makeDie(throwRandom(seed, -1 - i), offsets[i], radius, stage.before, lyingHeight(dieGeometry(die.sides))),
    sides: die.sides,
    waits: die.follows !== undefined,
    burst: burstOf(scene.plan, i),
  }));
  const stepRandoms = scene.plan.map((_, i) => throwRandom(seed, 1000 + i));
  const walls = stage.measure();
  if (walls) for (const die of dice) if (die.anim.phase === 'rest') die.anim.stage = walls;
  const targets = dice.map((die, i) => {
    const geometry = dieGeometry(die.sides);
    // Each die lies turned a little differently, as thrown dice do; from the seed, like the rest of the throw.
    const yaw = (throwRandom(seed, 2000 + i)() * 2 - 1) * REST_YAW;
    return restingQuaternion(geometry, faceIndexForValue(geometry, scene.faces[i] ?? 1), yaw);
  });
  const anims = dice.map((die) => die.anim);
  if (reduced) anims.forEach((anim, i) => restImmediately(anim, targets[i]!));
  else beginThrow(anims, scene.plan, targets, (i) => throwRandom(seed, i), style.maxWallHits);
  return { dice, stepRandoms };
}
