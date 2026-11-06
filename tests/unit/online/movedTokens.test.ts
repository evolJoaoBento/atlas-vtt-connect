import { describe, expect, it, vi } from 'vitest';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import { followMovedTokens } from '../../../src/app/online/control/movedTokens';

const tabs = { tabs: () => [{ viewId: 'v1', tabId: 'ground', mapPath: 'maps/ground.atlasmap', name: 'Ground' }, { viewId: 'v1', tabId: 'up', mapPath: 'maps/up.atlasmap', name: 'Upstairs' }] };

describe('tokens moved to another scene', () => {
  it('their players keep them and are shown the scene they went to; others stay where they were', async () => {
    const control = new TokenControl();
    control.set('hero', 'anna', true);
    control.set('ally', 'ben', true);
    control.set('orc', 'cara', true);
    const assign = vi.fn(() => Promise.resolve('ok'));
    followMovedTokens({ control, tabs, assign })({ from: 'maps/ground.atlasmap', to: 'maps/up.atlasmap', tokens: [{ id: 'hero', newId: 'hero' }, { id: 'ally', newId: 'tok_9' }] });
    expect(control.playersOf('hero')).toEqual(['anna']);
    expect(control.playersOf('tok_9')).toEqual(['ben']);
    expect(assign.mock.calls).toEqual([['anna', { viewId: 'v1', tabId: 'up' }], ['ben', { viewId: 'v1', tabId: 'up' }]]);
    await Promise.resolve();
  });

  it('a scene not open as a tab: the players keep the tokens and see what they saw', () => {
    const control = new TokenControl();
    control.set('hero', 'anna', true);
    const assign = vi.fn(() => Promise.resolve('ok'));
    followMovedTokens({ control, tabs, assign })({ from: 'maps/ground.atlasmap', to: 'maps/cellar.atlasmap', tokens: [{ id: 'hero', newId: 'hero' }] });
    expect(control.playersOf('hero')).toEqual(['anna']);
    expect(control.isMoving('hero')).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });

  it('a token nobody controls moves without showing anyone anything', () => {
    const assign = vi.fn(() => Promise.resolve('ok'));
    followMovedTokens({ control: new TokenControl(), tabs, assign })({ from: 'maps/ground.atlasmap', to: 'maps/up.atlasmap', tokens: [{ id: 'crate', newId: 'crate' }] });
    expect(assign).not.toHaveBeenCalled();
  });
});
