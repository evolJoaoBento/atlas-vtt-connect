import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { canBringEveryoneBack, syncSplitState } from '../../../src/app/online/splitStore';
import { character, splitWorld, tab, VIEW } from './splitFixtures';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => { resetOnlineSessionStore(); });
  vi.useRealTimers();
});

describe('the split party in the GM\'s store', () => {
  it('follows assignments, the scenes in use and closed tabs, and stops with its disposer', async () => {
    const w = await splitWorld();
    await w.present('a');
    const ben = await w.join('ben');
    const stop = syncSplitState(w.hub);
    expect(onlineSessionStore.getState()).toMatchObject({ split: 'on', assignments: {}, assignedCount: 0, scenesInUse: 1 });
    w.assignments.assign(ben.playerId, tab('c'), tab('a'));
    expect(onlineSessionStore.getState()).toMatchObject({ assignments: { [ben.playerId]: tab('c') }, assignedCount: 1, scenesInUse: 2 });
    w.atlas.views.removeTab(VIEW, 'c');
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineSessionStore.getState()).toMatchObject({ assignments: {}, assignedCount: 0, scenesInUse: 1 });
    stop();
    w.assignments.assign(ben.playerId, tab('b'), tab('a'));
    expect(onlineSessionStore.getState().assignedCount).toBe(0);
  });

  it('writes nothing on the live scene\'s ticks: Atlas reads its slots again on every store change', async () => {
    const w = await splitWorld();
    await w.present('a');
    const ben = await w.join('ben');
    syncSplitState(w.hub);
    w.assignments.assign(ben.playerId, tab('b'), tab('a'));
    const writes = vi.fn();
    const unsubscribe = onlineSessionStore.subscribe(writes);
    for (let x = 200; x < 260; x += 10) {
      w.editTokens({ hero: character('hero', x) });
      await w.tick();
    }
    expect(writes).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('says unsupported on an Atlas without scene tabs', () => {
    const stop = syncSplitState({ splitSupported: () => false, assignedTabs: () => ({}), scenesInUse: () => 0, onSlotChange: () => () => undefined } as never);
    expect(onlineSessionStore.getState().split).toBe('unsupported');
    stop();
  });

  it('brings everyone back only while hosting, with someone assigned and a scene presented (D9)', () => {
    const presented = { current: (): { viewId: string; tabId: string } | null => ({ viewId: VIEW, tabId: 'a' }) };
    act(() => { onlineSessionStore.setState({ status: 'hosting', split: 'on', assignedCount: 1 }); });
    expect(canBringEveryoneBack(presented as never)).toBe(true);
    expect(canBringEveryoneBack({ current: () => null } as never)).toBe(false);
    act(() => { onlineSessionStore.setState({ assignedCount: 0 }); });
    expect(canBringEveryoneBack(presented as never)).toBe(false);
  });
});
