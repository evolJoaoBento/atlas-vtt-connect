import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionPlayer } from '../../../src/app/online/GmSession';
import { tabBadge } from '../../../src/app/online/gm-ui/tabBadge';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';

const players: SessionPlayer[] = [
  { playerId: 'p1', name: 'Anna', status: 'admitted' },
  { playerId: 'p2', name: 'Ben', status: 'admitted' },
  { playerId: 'p3', name: 'Cy', status: 'pending' },
  { playerId: 'p4', name: 'Dan', status: 'gone' },
];
const tab = (tabId: string): { viewId: string; tabId: string } => ({ viewId: 'v', tabId });
let presented: { viewId: string; tabId: string } | null = tab('a');
const badgeOf = tabBadge({ current: () => presented as never });

afterEach(() => {
  act(() => { resetOnlineSessionStore(); });
  presented = tab('a');
});

describe('the eye\'s badge (spec 3.7)', () => {
  it('badges every tab with players while split and none otherwise', () => {
    act(() => { onlineSessionStore.setState({ status: 'hosting', split: 'on', players }); });
    expect(['a', 'b', 'c'].map((id) => badgeOf(tab(id)))).toEqual([null, null, null]);
    act(() => { onlineSessionStore.setState({ assignments: { p2: tab('b') }, assignedCount: 1 }); });
    expect(['a', 'b', 'c'].map((id) => badgeOf(tab(id)))).toEqual(['2 players', '1 player', null]);
  });

  it('the presented tab\'s badge counts its followers, disconnected ones too, never waiting ones', () => {
    act(() => { onlineSessionStore.setState({ status: 'hosting', split: 'on', players, assignments: { p1: tab('b') }, assignedCount: 1 }); });
    expect(badgeOf(tab('a'))).toBe('2 players');
    presented = null;
    expect(badgeOf(tab('a'))).toBeNull();
    expect(badgeOf(tab('b'))).toBe('1 player');
  });

  it('badges nothing while not hosting or on an Atlas without scene tabs', () => {
    act(() => { onlineSessionStore.setState({ players, assignments: { p2: tab('b') }, assignedCount: 1 }); });
    expect(badgeOf(tab('b'))).toBeNull();
    act(() => { onlineSessionStore.setState({ status: 'hosting', split: 'unsupported' }); });
    expect(badgeOf(tab('b'))).toBeNull();
  });
});
