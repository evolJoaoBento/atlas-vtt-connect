/**
 * Atlas 0.19's initiative: the order the GM dragged the sides into (`InitiativeState.sideOrder`, `inSideOrder`) before a
 * fight by sides starts. Players' side rows follow it; a running fight's own order (`sides.order`) still wins.
 */
import { describe, expect, it } from 'vitest';
import { sideRows } from '../../../src/app/online/scene/initiativeSides';
import { projectInitiative } from '../../../src/app/online/scene/projectPanels';
import { createDefaultInitiativeState } from './sceneFixtures';

const NAMED = [{ id: 'players' }, { id: 'opponents' }, { id: 'guards', name: 'Guards' }, { id: 'rats', name: 'Rats' }];
const ids = (rows: readonly { id: string }[]) => rows.map((row) => row.id);

describe('Atlas 0.19: the sides before a fight follow the order the GM dragged them into', () => {
  it('lists those named first, in that order, and the rest after in the rules order', () => {
    const rows = sideRows({ active: false, round: 0, fight: undefined, rulesSides: NAMED, firstSide: 'players', sideOrder: ['rats', 'players'] });
    expect(ids(rows)).toEqual(['rats', 'players', 'opponents', 'guards']);
  });

  it('keeps the rules order without an order, with an order that names nothing the rules have, or one that is not a list', () => {
    for (const sideOrder of [undefined, [], ['ghost'], 'rats', null, [3, {}]]) {
      const rows = sideRows({ active: false, round: 0, fight: undefined, rulesSides: NAMED, firstSide: 'players', sideOrder: sideOrder as never });
      expect(ids(rows)).toEqual(['players', 'opponents', 'guards', 'rats']);
    }
  });

  it('orders the two built-in sides when the collection names no others', () => {
    const rows = sideRows({ active: false, round: 0, fight: undefined, rulesSides: undefined, firstSide: 'players', sideOrder: ['opponents', 'players'] });
    expect(ids(rows)).toEqual(['opponents', 'players']);
  });

  it('leaves a running fight to its own order', () => {
    const fight = { first: 'players', active: 'players', order: [{ id: 'players' }, { id: 'opponents' }] };
    const rows = sideRows({ active: true, round: 1, fight, rulesSides: undefined, firstSide: 'players', sideOrder: ['opponents', 'players'] });
    expect(ids(rows)).toEqual(['players', 'opponents']);
  });

  it('reaches the players: the side list of a fight not yet started follows the order, and a list that is no list is ignored', () => {
    const rules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
    const initiativeRules = { mode: 'sides', roll: '1d20', firstSide: 'players', sides: NAMED } as never;
    // A side is named only where it holds a combatant players see.
    const sides = ['players', 'opponents', 'guards', 'rats'];
    const tokens = Object.fromEntries(sides.map((side) => [side, { id: side, kind: 'character', side }]));
    const entries = sides.map((side, order) => ({ id: `e-${side}`, tokenId: side, name: side, initiative: 0, isActive: false, order }));
    const sent = (sideOrder: unknown) => projectInitiative({
      initiative: { ...createDefaultInitiativeState(), isActive: false, sideOrder, entries },
      initiativeTrackerOpen: true,
      objects: { tokens },
    } as never, new Set(sides), rules, [], initiativeRules)?.sideList?.map((row) => row.id);
    expect(sent(['rats', 'players'])).toEqual(['rats', 'players', 'opponents', 'guards']);
    expect(sent('rats')).toEqual(['players', 'opponents', 'guards', 'rats']);
  });
});
