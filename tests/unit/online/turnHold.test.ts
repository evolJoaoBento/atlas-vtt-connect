import { describe, expect, it } from 'vitest';
import { movesOutOfTurn } from '../../../src/app/online/control/turnHold';

// The fight as the GM's store holds it (Atlas 0.18's `movesOutOfTurn`, online/gm/turnShare.ts, is the model).
type Entry = { id: string; tokenId?: string; partyMemberId?: string; name: string; isActive: boolean; sitsOut?: boolean; delayed?: true; order: number };
const entry = (tokenId: string, patch: Partial<Entry> = {}): Entry => ({ id: `e-${tokenId}`, tokenId, name: tokenId, isActive: false, order: 0, ...patch });
const tokens = (sides: Record<string, string> = {}) => Object.fromEntries(['ana', 'bo', 'orc', 'loose'].map((id) => [id, { id, kind: 'character', x: 0, y: 0, ...(sides[id] ? { side: sides[id] } : {}) }]));
const state = (initiative: object | null, sides: Record<string, string> = {}, open = true) => ({
  initiative, initiativeTrackerOpen: open, objects: { tokens: tokens(sides) },
}) as never;
const fight = (entries: Entry[], extra: object = {}) => ({ isActive: true, round: 2, entries, ...extra });

describe('which tokens a running fight holds still (Atlas: players move only on their turn)', () => {
  it('holds every token in the fight but the one whose turn it is, in a list in turn order', () => {
    const s = state(fight([entry('ana', { isActive: true }), entry('bo'), entry('orc')]));
    expect(movesOutOfTurn(s, [], 'ana')).toBe(false);
    expect(movesOutOfTurn(s, [], 'bo')).toBe(true);
    expect(movesOutOfTurn(s, [], 'orc')).toBe(true);
    // A token that is not in the fight is never held.
    expect(movesOutOfTurn(s, [], 'loose')).toBe(false);
    expect(movesOutOfTurn(s, [], 'nobody')).toBe(false);
  });

  it('holds nothing without a fight', () => {
    expect(movesOutOfTurn(state(null), [], 'ana')).toBe(false);
    expect(movesOutOfTurn(state({ isActive: false, round: 0, entries: [entry('ana')] }), [], 'ana')).toBe(false);
  });

  it('holds for the whole fight: the tracker closed does not free a token (Atlas 0.18, commit ca0a5038)', () => {
    const closed = state(fight([entry('ana', { isActive: true }), entry('bo')]), {}, false);
    expect(movesOutOfTurn(closed, [], 'bo')).toBe(true);
    expect(movesOutOfTurn(closed, [], 'ana')).toBe(false);
  });

  it('does not count a delayed combatant as holding the turn', () => {
    const s = state(fight([entry('ana', { isActive: true, delayed: true }), entry('bo')]));
    expect(movesOutOfTurn(s, [], 'ana')).toBe(true);
    expect(movesOutOfTurn(s, [], 'bo')).toBe(true);
  });

  it('holds every token while the turn is a combatant without a token (a party member or an enemy added by name)', () => {
    const s = state(fight([entry('ana'), entry('bo'), { id: 'p1', partyMemberId: 'pm', name: 'Zed', isActive: true, order: 2 }]));
    expect(movesOutOfTurn(s, [], 'ana')).toBe(true);
    expect(movesOutOfTurn(s, [], 'bo')).toBe(true);
  });

  it('by sides, lets every combatant of the side whose turn it is move, and holds the others and those who sit out', () => {
    const sides = { first: 'players', active: 'players' };
    const s = state(fight([entry('ana'), entry('bo', { sitsOut: true }), entry('orc')], { sides }), { ana: 'players', bo: 'players', orc: 'opponents' });
    expect(movesOutOfTurn(s, [], 'ana')).toBe(false);
    expect(movesOutOfTurn(s, [], 'bo')).toBe(true);
    expect(movesOutOfTurn(s, [], 'orc')).toBe(true);
    const theirs = state(fight([entry('ana'), entry('orc')], { sides: { first: 'players', active: 'opponents' } }), { ana: 'players', orc: 'opponents' });
    expect(movesOutOfTurn(theirs, [], 'ana')).toBe(true);
    expect(movesOutOfTurn(theirs, [], 'orc')).toBe(false);
  });

  it('by sides, lets a player at the table (no token) take its side\'s turn without freeing the opponents', () => {
    const s = state(fight([entry('orc'), { id: 'p1', partyMemberId: 'pm', name: 'Zed', isActive: false, order: 1 }], { sides: { first: 'players', active: 'players' } }), { orc: 'opponents' });
    expect(movesOutOfTurn(s, [], 'orc')).toBe(true);
  });

  it('by sides, holds a named side\'s tokens until it acts, and every tied side acts together', () => {
    const order = [{ id: 'goblins', name: 'Goblins' }, { id: 'players' }, { id: 'opponents' }];
    const sides = (active: string) => ({ first: 'players', active, order, roll: '1d20', rolls: { 2: { goblins: 15, players: 15, opponents: 3 } } });
    const entries = [entry('ana'), entry('bo', { }), entry('orc')];
    const named = (id: string) => state(fight(entries, { sides: sides(id) }), { ana: 'players', bo: 'goblins', orc: 'opponents' });
    // goblins and players tie at 15: both act, the opponents wait.
    expect([movesOutOfTurn(named('goblins'), [], 'ana'), movesOutOfTurn(named('goblins'), [], 'bo'), movesOutOfTurn(named('goblins'), [], 'orc')]).toEqual([false, false, true]);
    expect([movesOutOfTurn(named('opponents'), [], 'ana'), movesOutOfTurn(named('opponents'), [], 'orc')]).toEqual([true, false]);
  });

  it('by sides, holds a combatant the map\'s resources call defeated', () => {
    const definitions = [{ key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#ff0000', defeatedWhenSpent: true, visibleToPlayers: true }] as never;
    const dead = { id: 'ana', kind: 'character', x: 0, y: 0, side: 'players', resources: { hp: { current: 0, max: 5 } } };
    const s = { initiative: fight([entry('ana'), entry('bo')], { sides: { first: 'players', active: 'players' } }), initiativeTrackerOpen: true, objects: { tokens: { ana: dead, bo: { id: 'bo', kind: 'character', x: 0, y: 0, side: 'players' } } } } as never;
    expect(movesOutOfTurn(s, definitions, 'bo')).toBe(false);
    expect(movesOutOfTurn(s, definitions, 'ana')).toBe(true);
  });
});
