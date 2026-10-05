import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onlineSessionStore, resetOnlineSessionStore } from '../../src/app/online/onlineSessionStore';
import { anna, cy, gmUiHarness, type GmUiHarness } from './online/gmUiFixtures';

let harness: GmUiHarness;
const bob = { playerId: 'p9', name: 'Bob', status: 'pending' } as const;

beforeEach(() => { harness = gmUiHarness(); });
afterEach(() => {
  harness.gm();
  act(() => { resetOnlineSessionStore(); });
});

const online = (): ReturnType<GmUiHarness['ui']['drawToolbar']>[number] => harness.ui.drawToolbar(harness.scene.view).find((item) => item.id === 'online')!;

describe('online toolbar item', () => {
  it('is one toolbar button, "Online session", with the network icon at priority 60', () => {
    expect(harness.ui.counts().toolbar).toBe(1);
    expect(online()).toMatchObject({ id: 'online', icon: 'network', label: 'Online session', priority: 60 });
  });

  it('shows no mark while no session runs', () => {
    expect(online()).toMatchObject({ active: false, badge: null });
  });

  it('is in use while hosting, and shows the number of waiting players on it when there are any', () => {
    harness.host([anna]);
    expect(online()).toMatchObject({ active: true, badge: null });
    act(() => { onlineSessionStore.setState({ players: [anna, cy, bob] }); });
    expect(online()).toMatchObject({ active: true, badge: 2 });
  });

  it('shows no waiting count outside a hosted session, and never 0', () => {
    act(() => { onlineSessionStore.setState({ status: 'idle', players: [cy] }); });
    expect(online().badge).toBeNull();
    harness.host([anna]);
    expect(online().badge).toBeNull();
  });

  it('toggles the panel in the view it was clicked in', () => {
    harness.ui.clickToolbar('online', harness.scene.view);
    expect(harness.ui.panelContainer('online', harness.scene.view)).not.toBeNull();
    harness.ui.clickToolbar('online', harness.scene.view);
    expect(harness.ui.panelContainer('online', harness.scene.view)).toBeNull();
  });

  it('draws nothing in a player view', () => {
    harness.atlas.views.open('player');
    harness.ui.markPlayerView('player');
    expect(harness.ui.drawToolbar('player')).toEqual([]);
  });
});
