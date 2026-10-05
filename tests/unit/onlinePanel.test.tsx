import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKENS_UNAVAILABLE_NOTICE } from '../../src/app/online/control/TokenControlHost';
import { onlineSessionStore, resetOnlineSessionStore } from '../../src/app/online/onlineSessionStore';
import { anna, ben, dan, gmUiHarness, type GmUiHarness } from './online/gmUiFixtures';

// The fork's panel was a window of the map view with its own frame and close button. Atlas draws that now, so the
// fork's "closes with its close button" case is Atlas's (its panel frame); these cases are the panel's content.
let harness: GmUiHarness;

beforeEach(() => {
  harness = gmUiHarness({ join: true });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(() => Promise.resolve()) } });
});
afterEach(() => {
  harness.gm();
  cleanup();
  act(() => { resetOnlineSessionStore(); });
});

describe('online panel', () => {
  it('is the registered panel "Online session", rendered with Connect\'s own React root, and unmounted when it closes', async () => {
    const container = await harness.openPanel();
    expect(harness.ui.counts().panel).toBe(1);
    expect(container.querySelector('.atlas-connect-panel')).not.toBeNull();
    harness.gm();
    expect(harness.ui.panelContainer('online', harness.scene.view)).toBeNull();
    expect(document.querySelector('.atlas-connect-panel')).toBeNull();
  });

  it('unmounts when its view closes, and releases what it listened to', async () => {
    harness.host([anna]);
    await harness.openPanel();
    const withPanel = harness.atlas.listenerCount();
    act(() => { harness.atlas.views.close(harness.scene.view); });
    expect(document.querySelector('.atlas-connect-panel')).toBeNull();
    const closedWithPanel = harness.atlas.listenerCount();
    expect(closedWithPanel).toBeLessThan(withPanel);

    // The same view closing with the panel never opened leaves just as many listeners.
    harness.gm();
    harness = gmUiHarness();
    harness.host([anna]);
    act(() => { harness.atlas.views.close(harness.scene.view); });
    expect(closedWithPanel).toBe(harness.atlas.listenerCount());
  });

  it('offers to start a session while not hosting', async () => {
    const panel = within(await harness.openPanel());
    expect(panel.getByText(/Start a session to get a link/)).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Start online session' }));
    expect(harness.service.start).toHaveBeenCalledOnce();
    expect(panel.queryByRole('button', { name: 'Stop online session' })).toBeNull();
  });

  it('waits while starting and shows a failed start with the button back', async () => {
    act(() => { onlineSessionStore.setState({ status: 'starting' }); });
    const panel = within(await harness.openPanel());
    expect((panel.getByRole('button', { name: 'Starting…' }) as HTMLButtonElement).disabled).toBe(true);
    act(() => { onlineSessionStore.setState({ status: 'error', error: 'Timed out reaching the signaling server' }); });
    expect(panel.getByRole('alert').textContent).toBe('Timed out reaching the signaling server');
    expect((panel.getByRole('button', { name: 'Start online session' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the status, the link and no players yet while hosting, and stops the session', async () => {
    harness.host();
    const panel = within(await harness.openPanel());
    expect(panel.getByText('Connected')).toBeTruthy();
    expect((panel.getByRole('textbox', { name: 'Join link' }) as HTMLInputElement).value).toBe('https://example.org/join/#abc');
    fireEvent.click(panel.getByRole('button', { name: 'Copy link' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.org/join/#abc');
    expect(panel.getByText('No players yet. Share the link to invite them.')).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Stop online session' }));
    expect(harness.service.stop).toHaveBeenCalledOnce();
  });

  it('shows a hosting error under the status', async () => {
    harness.host();
    const panel = within(await harness.openPanel());
    act(() => { onlineSessionStore.setState({ error: 'Lost the signaling server' }); });
    expect(panel.getByText('Connected')).toBeTruthy();
    expect(panel.getByRole('status').textContent).toBe('Lost the signaling server');
  });

  it('lets the GM allow or deny waiting players', async () => {
    harness.host([{ playerId: 'p2', name: 'Bob', status: 'pending' }]);
    const bob = within(within(await harness.openPanel()).getByRole('listitem', { name: 'Bob' }));
    fireEvent.click(bob.getByRole('button', { name: 'Allow' }));
    fireEvent.click(bob.getByRole('button', { name: 'Deny' }));
    expect(harness.service.allow).toHaveBeenCalledWith('p2');
    expect(harness.service.deny).toHaveBeenCalledWith('p2');
  });

  it('lists players with the tokens they control, and removes a player with its X button', async () => {
    const control = harness.host([anna, dan]);
    control.set('hero', 'p1', true);
    harness.present(harness.scene.view, harness.scene.tavern);
    const panel = within(await harness.openPanel());

    const row = within(panel.getByRole('listitem', { name: 'Anna' }));
    expect(row.getByText('Hero')).toBeTruthy();
    expect(row.queryByRole('button', { name: 'Tokens…' })).toBeNull();
    act(() => { control.set('goblin', 'p1', true); });
    expect(row.getByText('Goblin')).toBeTruthy();

    fireEvent.click(row.getByRole('button', { name: 'Remove player Anna' }));
    expect(harness.service.kick).toHaveBeenCalledWith('p1');
    expect(within(panel.getByRole('listitem', { name: 'Dan' })).getByText('Disconnected')).toBeTruthy();
  });

  it('presents this view or stops presenting', async () => {
    harness.host();
    const panel = within(await harness.openPanel());
    expect(panel.getByText('Players see no scene.')).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Stop presenting' })).toBeNull();

    await act(async () => { fireEvent.click(panel.getByRole('button', { name: 'Present to players' })); });
    expect(harness.atlas.presentation.current()).toMatchObject({ viewId: harness.scene.view, tabId: 'tavern' });
    expect(panel.getByText('Players see Tavern.')).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Present to players' })).toBeNull();

    fireEvent.click(panel.getByRole('button', { name: 'Stop presenting' }));
    expect(harness.atlas.presentation.current()).toBeNull();
    expect(panel.getByText('Players see no scene.')).toBeTruthy();
  });

  it('offers Present to players again when the view moves to another tab', async () => {
    harness.host();
    harness.present(harness.scene.view, harness.scene.tavern);
    const panel = within(await harness.openPanel());
    expect(panel.queryByRole('button', { name: 'Present to players' })).toBeNull();
    act(() => { harness.scene.tabs.getState().setActiveTab(harness.scene.dungeon); });
    expect(panel.getByRole('button', { name: 'Present to players' })).toBeTruthy();
  });

  // Review Focus
  it('does not show the characters of another map while the presented scene is held', async () => {
    const control = harness.host([anna]);
    control.set('hero', 'p1', true);
    harness.present(harness.scene.view, harness.scene.tavern);
    const row = within(within(await harness.openPanel()).getByRole('listitem', { name: 'Anna' }));
    expect(row.getByText('Hero')).toBeTruthy();

    act(() => { harness.scene.tabs.getState().setActiveTab(harness.scene.dungeon); });
    expect(harness.isHeld()).toBe(true);
    expect(row.queryByText('Hero')).toBeNull();
  });

  it('falls back to the start view when the session stops elsewhere', async () => {
    harness.host([anna]);
    const panel = within(await harness.openPanel());
    act(() => { resetOnlineSessionStore(); });
    expect(panel.getByRole('button', { name: 'Start online session' })).toBeTruthy();
    expect(panel.queryByRole('listitem', { name: 'Anna' })).toBeNull();
  });

  it('offers to join a session from here when Connect can join, and not otherwise', async () => {
    const panel = within(await harness.openPanel());
    fireEvent.click(panel.getByRole('button', { name: 'Join online session…' }));
    expect(harness.joinSession).toHaveBeenCalledOnce();

    harness.gm();
    cleanup();
    harness = gmUiHarness();
    expect(within(await harness.openPanel()).queryByRole('button', { name: 'Join online session…' })).toBeNull();
  });

  it('marks a player who joined from Obsidian', async () => {
    harness.host([{ ...anna, client: 'obsidian' }, ben]);
    const panel = within(await harness.openPanel());
    expect(within(panel.getByRole('listitem', { name: 'Anna' })).getByRole('img', { name: 'Joined from Obsidian' })).toBeTruthy();
    expect(within(panel.getByRole('listitem', { name: 'Ben' })).queryByRole('img', { name: 'Joined from Obsidian' })).toBeNull();
  });

  it('names a waiting Obsidian player and links a new device to the person its name matches', async () => {
    harness.host([{ playerId: 'p5', name: 'Eve', status: 'pending', client: 'obsidian' }]);
    act(() => {
      onlineSessionStore.setState({ requests: { p5: { kind: 'new', sameName: { personId: 'person-eve', name: 'Eve' } } as never } });
    });
    const eve = within(within(await harness.openPanel()).getByRole('listitem', { name: 'Eve' }));
    expect(eve.getByText('(new)')).toBeTruthy();
    expect(eve.getByRole('note').textContent).toBe('Someone named Eve is already in your people list');
    fireEvent.click(eve.getByRole('button', { name: 'Link to Eve' }));
    expect(harness.service.link).toHaveBeenCalledWith('p5', 'person-eve');
  });

  it('tells the GM when this Atlas cannot land players\' moves: hosting without token control', async () => {
    harness.host();
    act(() => { onlineSessionStore.setState({ tokenControl: null }); });
    const panel = within(await harness.openPanel());
    expect(panel.getByRole('note').textContent).toBe(TOKENS_UNAVAILABLE_NOTICE);
  });

  it('does not show that notice while token control runs, nor when no session is hosted', async () => {
    harness.host();
    const panel = within(await harness.openPanel());
    expect(panel.queryByText(TOKENS_UNAVAILABLE_NOTICE)).toBeNull();
    act(() => { resetOnlineSessionStore(); });
    expect(panel.queryByText(TOKENS_UNAVAILABLE_NOTICE)).toBeNull();
  });
});
