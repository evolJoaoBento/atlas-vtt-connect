import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaletteCommand } from '@atlas-vtt/api-types';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { gmUiHarness, type GmUiHarness } from './gmUiFixtures';

let harness: GmUiHarness;

beforeEach(() => { harness = gmUiHarness(); });
afterEach(() => {
  harness.gm();
  act(() => { resetOnlineSessionStore(); });
});

const commands = (): PaletteCommand[] => harness.ui.palette(harness.scene.view).find((section) => section.id === 'online')?.commands ?? [];
const command = (label: string): PaletteCommand | undefined => commands().find((entry) => entry.label === label);

describe('Online play in the command palette', () => {
  it('is the section "Online play", which always offers the online session panel', () => {
    expect(harness.ui.palette(harness.scene.view).map((section) => section.title)).toEqual(['Online play']);
    expect(command('Stop online session')).toBeUndefined();
    expect(command('Stop presenting')).toBeUndefined();
    expect(command('Online session')).toMatchObject({ icon: 'network', keywords: ['online', 'players', 'join', 'link', 'host'] });
    command('Online session')!.run();
    expect(harness.ui.panelContainer('online', harness.scene.view)).not.toBeNull();
  });

  it('offers Present to players for an open scene not presented, and Stop presenting while one is', async () => {
    expect(commands().map((entry) => entry.id)).toEqual(['online-session', 'present-to-players']);
    await act(async () => { command('Present to players')!.run(); });
    expect(harness.atlas.presentation.current()).toMatchObject({ tabId: 'tavern' });
    expect(command('Present to players')).toBeUndefined();
    command('Stop presenting')!.run();
    expect(harness.atlas.presentation.current()).toBeNull();
  });

  it('offers to present again once the view shows another tab', () => {
    harness.present(harness.scene.view, harness.scene.tavern);
    expect(command('Present to players')).toBeUndefined();
    harness.scene.tabs.getState().setActiveTab(harness.scene.dungeon);
    expect(command('Present to players')).toBeDefined();
    expect(command('Stop presenting')).toBeDefined();
  });

  it('offers Stop online session while hosting', () => {
    harness.host();
    command('Stop online session')!.run();
    expect(harness.service.stop).toHaveBeenCalledOnce();
  });

  it('offers nothing in a player view', () => {
    harness.atlas.views.open('player');
    harness.ui.markPlayerView('player');
    expect(harness.ui.palette('player')).toEqual([]);
  });

  it('is read again, not stale: a session that starts or a scene presented shows in the next draw', () => {
    onlineSessionStore.setState({ status: 'hosting' });
    expect(command('Stop online session')).toBeDefined();
    onlineSessionStore.setState({ status: 'idle' });
    expect(command('Stop online session')).toBeUndefined();
  });
});

describe('Online play in the map\'s More options menu', () => {
  const items = (): string[] => harness.ui.viewMenu(harness.scene.view).map((item) => item.label);

  it('offers "Online session…", which opens the panel, and Present to players', () => {
    expect(items()).toEqual(['Online session…', 'Present to players']);
    harness.ui.viewMenu(harness.scene.view)[0]!.onClick!();
    expect(harness.ui.panelContainer('online', harness.scene.view)).not.toBeNull();
  });

  it('offers Stop presenting while a scene is presented, and Present to players runs the presentation', async () => {
    await act(async () => { harness.ui.viewMenu(harness.scene.view)[1]!.onClick!(); });
    expect(harness.atlas.presentation.current()).toMatchObject({ tabId: 'tavern' });
    expect(items()).toEqual(['Online session…', 'Stop presenting']);
    harness.ui.viewMenu(harness.scene.view)[1]!.onClick!();
    expect(harness.atlas.presentation.current()).toBeNull();
  });

  it('is empty in a player view', () => {
    harness.atlas.views.open('player');
    harness.ui.markPlayerView('player');
    expect(harness.ui.viewMenu('player')).toEqual([]);
  });
});
