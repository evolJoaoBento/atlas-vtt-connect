import type { DiceRollResult } from '@atlas-vtt/shared/rules';
import { describe, expect, it } from 'vitest';
import * as vendored from '@atlas-vtt/shared/dice3d';
import * as copies from '../../../src/app/dice3d/diceDisplay';
import { diceSceneToShow } from '../../../src/app/dice3d/rollPresentation';
import { sceneFromRolls } from '../../../src/app/dice3d/diceScene';

// The page's first script holds copies of three small Atlas modules, so it loads no three.js; the dice chunk
// runs the vendored ones. A sync that changes one of them fails here until the copy follows.
describe("the join page's copies of Atlas's dice display modules", () => {
  const rolls = [
    [{ die: 'd20', value: 20, max: 20 }, { die: 'd6', value: 3, max: 6 }],
    [{ die: 'd6', value: 2, max: 6 }, { die: 'd6', value: 5, max: 6, exploded: true }],
    [{ die: 'd13', value: 9, max: 13 }],
    Array.from({ length: 25 }, () => ({ die: 'd6', value: 1, max: 6 })),
    [],
  ] as unknown as Array<Parameters<typeof sceneFromRolls>[0]>;

  it('offer the same display choices, hints and throw styles', () => {
    expect(copies.DICE_DISPLAY_OPTIONS).toEqual(vendored.DICE_DISPLAY_OPTIONS);
    expect(copies.DICE_DISPLAY_HINTS).toEqual(vendored.DICE_DISPLAY_HINTS);
    for (const display of ['card', 'fast', 'full'] as const) expect(copies.throwStyle(display)).toEqual(vendored.throwStyle(display));
    expect(['fast', 'nope', 3, null].map(copies.isDiceDisplay)).toEqual(['fast', 'nope', 3, null].map(vendored.isDiceDisplay));
  });

  it('decide alike which rolls are thrown as dice and which show as a card', () => {
    for (const list of rolls) {
      expect(sceneFromRolls(list), JSON.stringify(list)).toEqual(vendored.sceneFromRolls(list));
      const result = { id: 'r', timestamp: 0, formula: '', rolls: list, modifiers: 0, total: 0, crit: null } as unknown as DiceRollResult;
      for (const display of ['card', 'fast', 'full'] as const) {
        expect(diceSceneToShow(result, display)).toEqual(vendored.diceSceneToShow(result, display));
      }
    }
  });
});
