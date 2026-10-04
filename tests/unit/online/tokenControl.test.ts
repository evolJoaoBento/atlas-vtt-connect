import { describe, expect, it } from 'vitest';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
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
