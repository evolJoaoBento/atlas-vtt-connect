import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '../../src/app/online/GmSession';
import { onlineSessionStore, resetOnlineSessionStore } from '../../src/app/online/onlineSessionStore';
import type { TabKey } from '../../src/app/online/split/tabKey';
import { anna, ben, gmUiHarness, type GmUiHarness } from './online/gmUiFixtures';

const cara: SessionPlayer = { playerId: 'p5', name: 'Cara', status: 'admitted' };

let harness: GmUiHarness;

/** Hosting with the split party on and these assignments (player id → tab id of the scene's view). */
function split(assignments: Record<string, string>, scenesInUse = 1 + new Set(Object.values(assignments)).size): void {
  const tabs: Record<string, TabKey> = Object.fromEntries(Object.entries(assignments).map(([playerId, tabId]) => [playerId, { viewId: harness.scene.view, tabId }]));
  act(() => { onlineSessionStore.setState({ split: 'on', assignments: tabs, assignedCount: Object.keys(tabs).length, scenesInUse }); });
}

async function hostSplit(players: SessionPlayer[], assignments: Record<string, string> = {}): Promise<ReturnType<typeof within>> {
  harness.host(players);
  harness.present(harness.scene.view, harness.scene.tavern);
  split(assignments);
  return within(await harness.openPanel());
}

beforeEach(() => {
  harness = gmUiHarness({ capabilities: ['scene-tabs'] });
});
afterEach(() => {
  vi.useRealTimers();
  harness.gm();
  cleanup();
  act(() => { resetOnlineSessionStore(); });
});

describe('the panel while the party is split', () => {
  // Who sees which scene is chosen from a scene tab's right-click or the Scenes menu; the panel has no Present to.
  it('has no Present to button, and no Everyone back with nobody split', async () => {
    const panel = await hostSplit([anna, ben]);
    expect(panel.getByText('Players see Tavern.')).toBeTruthy();
    expect(panel.queryByRole('button', { name: /^Present to/ })).toBeNull();
    expect(screen.queryByRole('group', { name: /^Present / })).toBeNull();
    expect(panel.queryByRole('button', { name: 'Everyone back to the presented scene' })).toBeNull();
  });

  it('shows 2 players are on other scenes and the Everyone back button', async () => {
    const panel = await hostSplit([anna, ben, cara], { p2: 'dungeon', p5: 'dungeon' });
    expect(panel.getByText('Players see Tavern. 2 players are on other scenes.')).toBeTruthy();
    split({ p2: 'dungeon' });
    expect(panel.getByText('Players see Tavern. 1 player is on another scene.')).toBeTruthy();
    expect(within(panel.getByRole('listitem', { name: 'Ben' })).getByText('On Dungeon')).toBeTruthy();
    expect(within(panel.getByRole('listitem', { name: 'Anna' })).queryByText(/^On /)).toBeNull();
    fireEvent.click(panel.getByRole('button', { name: 'Everyone back to the presented scene' }));
    expect(harness.service.everyoneBack).toHaveBeenCalledOnce();
  });

  it('the scene chip follows a tab rename', async () => {
    const panel = await hostSplit([anna, ben], { p2: 'dungeon' });
    expect(within(panel.getByRole('listitem', { name: 'Ben' })).getByText('On Dungeon')).toBeTruthy();
    await act(async () => { harness.atlas.views.renameTab(harness.scene.view, 'dungeon', 'Crypt'); await Promise.resolve(); });
    expect(within(panel.getByRole('listitem', { name: 'Ben' })).getByText('On Crypt')).toBeTruthy();
  });

  it('Everyone back is disabled with nothing presented (D9)', async () => {
    harness.host([anna, ben]);
    split({ p2: 'dungeon' });
    const panel = within(await harness.openPanel());
    expect((panel.getByRole('button', { name: 'Everyone back to the presented scene' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('states the cap at four scenes', async () => {
    const panel = await hostSplit([anna, ben], {});
    split({ p2: 'dungeon' }, 4);
    expect(panel.getByText('Players are on 4 scenes, the most at once. Bring players back to free one.')).toBeTruthy();
  });

  it('without scene-tabs shows the update note', async () => {
    harness.gm();
    harness = gmUiHarness();
    harness.host([anna]);
    harness.present(harness.scene.view, harness.scene.tavern);
    const panel = within(await harness.openPanel());
    expect(panel.getByText('Update Atlas VTT to show different scenes to different players.')).toBeTruthy();
  });
});

describe('Everyone back in the command palette', () => {
  const command = (): { run(): void } | undefined => harness.ui.palette(harness.scene.view).find((section) => section.id === 'online')
    ?.commands.find((entry) => entry.label === 'Bring all players back to the presented scene');

  it('is offered while someone is assigned and a scene is presented, and brings everyone back', async () => {
    harness.host([anna, ben]);
    expect(command()).toBeUndefined();
    split({ p2: 'dungeon' });
    expect(command()).toBeUndefined(); // nothing presented (D9)
    harness.present(harness.scene.view, harness.scene.tavern);
    command()!.run();
    expect(harness.service.everyoneBack).toHaveBeenCalledOnce();
    split({});
    expect(command()).toBeUndefined();
  });
});
