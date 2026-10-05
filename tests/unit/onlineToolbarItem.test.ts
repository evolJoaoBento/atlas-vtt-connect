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

  it('is in use with a dot while hosting, and shows the number of waiting players instead when there are any', () => {
    harness.host([anna]);
    expect(online()).toMatchObject({ active: true, badge: true });
    act(() => { onlineSessionStore.setState({ players: [anna, cy, bob] }); });
    expect(online()).toMatchObject({ active: true, badge: 2 });
  });

  it('shows no waiting count outside a hosted session, and never 0', () => {
    act(() => { onlineSessionStore.setState({ status: 'idle', players: [cy] }); });
    expect(online().badge).toBeNull();
    harness.host([anna]);
    expect(online().badge).toBe(true);
  });

  it('toggles the panel, and stays in the bar while the panel is open', () => {
    harness.ui.clickToolbar('online', harness.scene.view);
    expect(harness.ui.panelContainer('online', harness.scene.view)).not.toBeNull();
    expect(online().active).toBe(true);
    harness.ui.clickToolbar('online', harness.scene.view);
    expect(harness.ui.panelContainer('online', harness.scene.view)).toBeNull();
    expect(online().active).toBe(false);
  });

  it('asks Atlas to read the button again however the panel opens or closes', () => {
    let before = harness.ui.version();
    harness.ui.viewMenu(harness.scene.view)[0]!.onClick!(); // the More options entry
    expect(harness.ui.version()).toBeGreaterThan(before);
    before = harness.ui.version();
    harness.ui.closePanel('online', harness.scene.view); // Atlas's own close button
    expect(harness.ui.version()).toBeGreaterThan(before);
  });

  it('draws nothing in a player view', () => {
    // a player window is not one of Atlas's listed map views: no slot draws in it
    expect(harness.ui.drawToolbar('player')).toEqual([]);
  });
});
