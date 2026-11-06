import { describe, expect, it } from 'vitest';
import { MOVE_GRACE_MS, TokenControl } from '../../../src/app/online/control/TokenControl';
import { watchDeletedTokens } from '../../../src/app/online/control/deletedTokens';
import { MAX_CONTROLLED_TOKENS } from '../../../src/app/online/protocol';

function watched(): { control: TokenControl; changes: string[][] } {
  const control = new TokenControl();
  const changes: string[][] = [];
  control.onChange((playerIds) => changes.push([...playerIds]));
  return { control, changes };
}

describe('TokenControl', () => {
  it('gives a player several tokens and a token several players, telling who changed', () => {
    const { control, changes } = watched();
    control.set('hero', 'p1', true);
    control.set('ally', 'p1', true);
    control.set('hero', 'p2', true);
    expect(control.tokensOf('p1')).toEqual(['hero', 'ally']);
    expect(control.tokensOf('p2')).toEqual(['hero']);
    expect(control.controls('p2', 'hero')).toBe(true);
    expect(control.controls('p2', 'ally')).toBe(false);
    expect(control.assignedTokens()).toEqual(['hero', 'ally']);
    expect(changes).toEqual([['p1'], ['p1'], ['p2']]);
  });

  it('takes a token away, and ignores an assignment that changes nothing', () => {
    const { control, changes } = watched();
    control.set('hero', 'p1', true);
    control.set('hero', 'p1', true);
    control.set('ally', 'p1', false);
    control.set('hero', 'p1', false);
    expect(control.tokensOf('p1')).toEqual([]);
    expect(control.assignedTokens()).toEqual([]);
    expect(changes).toEqual([['p1'], ['p1']]);
  });

  it("skips ids the protocol would reject, so one bad id cannot void a player's whole list", () => {
    const { control, changes } = watched();
    control.set('hero', 'p1', true);
    for (const bad of ['', 'x'.repeat(500), '__proto__']) control.set(bad, 'p1', true);
    expect(control.tokensOf('p1')).toEqual(['hero']);
    expect(changes).toEqual([['p1']]);
  });

  it('gives no player more tokens than one control list carries', () => {
    const { control } = watched();
    for (let index = 0; index <= MAX_CONTROLLED_TOKENS; index++) control.set(`t${index}`, 'p1', true);
    expect(control.tokensOf('p1')).toHaveLength(MAX_CONTROLLED_TOKENS);
    expect(control.controls('p1', `t${MAX_CONTROLLED_TOKENS}`)).toBe(false);
  });

  it('drops deleted tokens and tells each of their players once', () => {
    const { control, changes } = watched();
    control.set('hero', 'p1', true);
    control.set('hero', 'p2', true);
    control.set('ally', 'p1', true);
    changes.length = 0;
    control.dropTokens(['hero', 'ally', 'unknown']);
    expect(control.assignedTokens()).toEqual([]);
    expect(changes).toEqual([['p1', 'p2']]);
    control.dropTokens(['hero']);
    expect(changes).toHaveLength(1);
  });

  it('forgets players the session no longer knows, and keeps the rest', () => {
    const { control, changes } = watched();
    control.set('hero', 'p1', true);
    control.set('hero', 'p2', true);
    control.set('ally', 'p2', true);
    changes.length = 0;
    control.retainPlayers(new Set(['p1']));
    expect(control.tokensOf('p1')).toEqual(['hero']);
    expect(control.tokensOf('p2')).toEqual([]);
    expect(control.assignedTokens()).toEqual(['hero']);
    expect(changes).toEqual([['p2']]);
    control.retainPlayers(new Set(['p1']));
    expect(changes).toHaveLength(1);
  });

  it('stops telling a listener that unsubscribed', () => {
    const control = new TokenControl();
    const changes: string[][] = [];
    const stop = control.onChange((playerIds) => changes.push([...playerIds]));
    stop();
    control.set('hero', 'p1', true);
    expect(changes).toEqual([]);
  });
});

describe('TokenControl: a token moved to another scene', () => {
  it('keeps its players under its new id, and is not taken for deleted while it moves', () => {
    const { control, changes } = watched();
    control.set('hero', 'anna', true);
    control.set('hero', 'ben', true);
    changes.length = 0;
    control.move('hero', 'tok_2', 1000);
    expect(control.playersOf('tok_2')).toEqual(['anna', 'ben']);
    expect(control.playersOf('hero')).toEqual([]);
    expect(changes).toEqual([['anna', 'ben']]);
    expect(control.isMoving('hero', 2000)).toBe(true);
    expect(control.isMoving('tok_2', 2000)).toBe(true);
    expect(control.isMoving('hero', 1000 + MOVE_GRACE_MS + 1)).toBe(false);
  });

  it('a token that keeps its id keeps its players with no change to tell', () => {
    const { control, changes } = watched();
    control.set('hero', 'anna', true);
    changes.length = 0;
    control.move('hero', 'hero', 0);
    expect(control.playersOf('hero')).toEqual(['anna']);
    expect(changes).toEqual([]);
    expect(control.isMoving('hero', 10)).toBe(true);
  });
});

describe('watchDeletedTokens', () => {
  it('drops a token deleted from the shown scene, but not one moved to another scene', () => {
    const control = new TokenControl();
    control.set('hero', 'anna', true);
    control.set('orc', 'ben', true);
    let live: ((sceneId: string, snapshot: unknown) => void) | null = null;
    const slot = { sceneId: 's1' };
    const projection = {
      shownSlot: () => slot,
      shownSnapshot: () => ({ objects: { tokens: { hero: {}, orc: {} } } }),
      onSlotChange: () => () => undefined,
      watchLive: (listener: (sceneId: string, snapshot: unknown) => void) => { live = listener; return () => undefined; },
    };
    const stop = watchDeletedTokens(projection as never, control);
    control.move('hero', 'hero');
    live!('s1', { loaded: true, objects: { tokens: {} } });
    expect(control.playersOf('hero')).toEqual(['anna']);
    expect(control.playersOf('orc')).toEqual([]);
    stop();
  });
});
