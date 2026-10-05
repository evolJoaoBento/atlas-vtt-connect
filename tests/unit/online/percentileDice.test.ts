import { describe, expect, it } from 'vitest';
import { rollBreakdown, sceneFromRolls } from '@atlas-vtt/shared/dice3d';
import type { DiceRollResult } from '@atlas-vtt/shared/rules';

// The page and the remote view throw a d100 with the shared package's dice: since Atlas 0.6 (API 1.14.0)
// the tens die lands on its own digit, with the 10 as 0, so 00 + 0 reads 100.
describe("the shared package's d100", () => {
  it('lands the tens die on the tens digit itself', () => {
    expect(sceneFromRolls([{ max: 100, value: 19 }])?.faces).toEqual([1, 9]);
    expect(sceneFromRolls([{ max: 100, value: 5 }])?.faces).toEqual([10, 5]);
    expect(sceneFromRolls([{ max: 100, value: 100 }])?.faces).toEqual([10, 10]);
  });

  it('reads the tens and units back in its breakdown', () => {
    const result: DiceRollResult = { id: 'r', timestamp: 0, formula: '1d100', rolls: [{ die: 'd100', value: 19, max: 100 }], modifiers: 0, total: 19, crit: null };
    expect(rollBreakdown(result, sceneFromRolls(result.rolls)!)).toBe('Tens 10, units 9');
  });
});
