import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '../../src/app/online/GmSession';
import { onlineSessionStore, resetOnlineSessionStore } from '../../src/app/online/onlineSessionStore';
import type { TabKey } from '../../src/app/online/split/tabKey';
import { anna, ben, dan, gmUiHarness, type GmUiHarness } from './online/gmUiFixtures';

const cara: SessionPlayer = { playerId: 'p5', name: 'Cara', status: 'admitted' };

let harness: GmUiHarness;

/** Hosting with the split party on and these assignments (player id → tab id of the scene's view). */
function split(assignments: Record<string, string>, scenesInUse = 1 + new Set(Object.values(assignments)).size): void {
  const tabs: Record<string, TabKey> = Object.fromEntries(Object.entries(assignments).map(([playerId, tabId]) => [playerId, { viewId: harness.scene.view, tabId }]));
  act(() => { onlineSessionStore.setState({ split: 'on', assignments: tabs, assignedCount: Object.keys(tabs).length, scenesInUse }); });
}

/** The service's assign and unassign write the store, as the hub's changes do. */
function liveService(): void {
  harness.service.assign.mockImplementation((playerId: string, tab: TabKey) => {
    const { assignments } = onlineSessionStore.getState();
    const next = { ...assignments };
    if (tab.tabId === harness.atlas.presentation.current()?.tabId) delete next[playerId];
    else next[playerId] = tab;
    act(() => { onlineSessionStore.setState({ assignments: next, assignedCount: Object.keys(next).length }); });
  });
  harness.service.unassign.mockImplementation((playerId: string) => {
    const next = { ...onlineSessionStore.getState().assignments };
    delete next[playerId];
    act(() => { onlineSessionStore.setState({ assignments: next, assignedCount: Object.keys(next).length }); });
  });
}

async function hostSplit(players: SessionPlayer[], assignments: Record<string, string> = {}): Promise<ReturnType<typeof within>> {
  harness.host(players);
  harness.present(harness.scene.view, harness.scene.tavern);
  split(assignments);
  return within(await harness.openPanel());
}

const presentTo = (panel: ReturnType<typeof within>): HTMLButtonElement => panel.getByRole('button', { name: /^Present to:/ });
/** The checklist, drawn into the document body (a portal), outside the panel's scrolling body (review I2). */
const popover = (_panel: ReturnType<typeof within>): HTMLElement | null => screen.queryByRole('group', { name: /^Present .+ to$/ });

beforeEach(() => {
  harness = gmUiHarness({ capabilities: ['scene-tabs'] });
});
afterEach(() => {
  vi.useRealTimers();
  harness.gm();
  cleanup();
  act(() => { resetOnlineSessionStore(); });
});

describe('the panel\'s Present to (spec 3.2)', () => {
  it('Present to: everyone when nobody is split', async () => {
    const panel = await hostSplit([anna, ben]);
    expect(presentTo(panel).textContent).toBe('Present to: everyone');
    expect(panel.getByText('Players see Tavern.')).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Everyone back to the presented scene' })).toBeNull();
  });

  it('names the players who see the GM\'s tab, and nobody on a tab nobody sees', async () => {
    const panel = await hostSplit([anna, ben, dan], { p2: 'dungeon' });
    expect(presentTo(panel).textContent).toBe('Present to: Anna, Dan');
    act(() => { harness.scene.tabs.getState().setActiveTab(harness.scene.dungeon); });
    expect(presentTo(panel).textContent).toBe('Present to: Ben');
    split({});
    expect(presentTo(panel).textContent).toBe('Present to: nobody');
  });

  it('opens on click with the tab\'s rows and toggles shut on a second click', async () => {
    const panel = await hostSplit([anna, ben]);
    act(() => { harness.scene.tabs.getState().setActiveTab(harness.scene.dungeon); });
    fireEvent.click(presentTo(panel));
    const group = within(popover(panel)!);
    expect(group.getByText('Present Dungeon to')).toBeTruthy();
    expect(group.getByRole('checkbox', { name: 'Anna · on Tavern' })).toBeTruthy();
    expect(group.getByRole('checkbox', { name: 'Ben · on Tavern' })).toBeTruthy();
    expect(presentTo(panel).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(presentTo(panel));
    expect(popover(panel)).toBeNull();
  });

  it('opens on hover after 300 ms and closes after the pointer leaves', async () => {
    vi.useFakeTimers();
    const panel = await hostSplit([anna]);
    const wrapper = presentTo(panel).parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(299); });
    expect(popover(panel)).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(popover(panel)).not.toBeNull();
    fireEvent.mouseLeave(wrapper);
    act(() => { vi.advanceTimersByTime(299); });
    expect(popover(panel)).not.toBeNull();
    // Back over the popover before the delay ends: it stays.
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(popover(panel)).not.toBeNull();
    fireEvent.mouseLeave(wrapper);
    act(() => { vi.advanceTimersByTime(300); });
    expect(popover(panel)).toBeNull();
  });

  // Review I2: the panel's body scrolls and clips what overflows it, so the checklist is not drawn inside it.
  it('draws the checklist outside the panel, at fixed coordinates under the button, kept inside the pane', async () => {
    const panel = await hostSplit([anna]);
    const container = await harness.openPanel();
    const button = presentTo(panel);
    const leaf = document.createElement('div');
    leaf.className = 'workspace-leaf';
    leaf.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 400, width: 300, height: 400, x: 0, y: 0, toJSON: () => ({}) });
    container.parentElement!.insertBefore(leaf, container);
    leaf.appendChild(container);
    button.getBoundingClientRect = () => ({ left: 250, top: 100, right: 380, bottom: 124, width: 130, height: 24, x: 250, y: 100, toJSON: () => ({}) });
    fireEvent.click(button);
    const list = popover(panel)!;
    expect(container.contains(list)).toBe(false);
    expect(list.parentElement).toBe(document.body);
    expect(list.style.top).toBe('128px');
    expect(Number.parseFloat(list.style.left)).toBeLessThanOrEqual(296);
    expect(list.style.maxHeight).toBe('268px');
  });

  it('the pointer moving from the button onto the checklist keeps it open', async () => {
    vi.useFakeTimers();
    const panel = await hostSplit([anna]);
    const wrapper = presentTo(panel).parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(300); });
    const list = popover(panel)!;
    fireEvent.mouseLeave(wrapper, { relatedTarget: list });
    fireEvent.mouseEnter(list);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(popover(panel)).not.toBeNull();
    fireEvent.mouseLeave(list, { relatedTarget: document.body });
    act(() => { vi.advanceTimersByTime(300); });
    expect(popover(panel)).toBeNull();
  });

  // Review Focus (B11): hover-open must not fight click-open.
  it('a click while hover-opened keeps it open, and the pointer leaving no longer closes it', async () => {
    vi.useFakeTimers();
    const panel = await hostSplit([anna]);
    const wrapper = presentTo(panel).parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(300); });
    fireEvent.click(presentTo(panel));
    expect(popover(panel)).not.toBeNull();
    fireEvent.mouseLeave(wrapper);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(popover(panel)).not.toBeNull();
  });

  it('stays open while ticking several players', async () => {
    liveService();
    const panel = await hostSplit([anna, ben, cara]);
    act(() => { harness.scene.tabs.getState().setActiveTab(harness.scene.dungeon); });
    fireEvent.click(presentTo(panel));
    fireEvent.click(within(popover(panel)!).getByRole('checkbox', { name: 'Anna · on Tavern' }));
    fireEvent.click(within(popover(panel)!).getByRole('checkbox', { name: 'Ben · on Tavern' }));
    const group = within(popover(panel)!);
    expect((group.getByRole('checkbox', { name: 'Anna' }) as HTMLInputElement).checked).toBe(true);
    expect((group.getByRole('checkbox', { name: 'Ben' }) as HTMLInputElement).checked).toBe(true);
    expect((group.getByRole('checkbox', { name: 'Cara · on Tavern' }) as HTMLInputElement).checked).toBe(false);
    expect(harness.service.assign).toHaveBeenCalledTimes(2);
    expect(presentTo(panel).textContent).toBe('Present to: Anna, Ben');
    fireEvent.click(group.getByRole('checkbox', { name: 'Anna' }));
    expect(harness.service.unassign).toHaveBeenCalledWith('p1');
    expect(popover(panel)).not.toBeNull();
  });

  it('Escape closes and returns focus to the button', async () => {
    const panel = await hostSplit([anna]);
    fireEvent.click(presentTo(panel));
    const box = within(popover(panel)!).getByRole('checkbox', { name: 'Anna' });
    box.focus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(popover(panel)).toBeNull();
    expect(document.activeElement).toBe(presentTo(panel));
  });

  it('a click outside closes it', async () => {
    const panel = await hostSplit([anna]);
    fireEvent.click(presentTo(panel));
    fireEvent.pointerDown(document.body);
    expect(popover(panel)).toBeNull();
  });

  it('a follower of the presented tab is ticked and cannot be unticked there (D16)', async () => {
    const panel = await hostSplit([anna]);
    fireEvent.click(presentTo(panel));
    const box = within(popover(panel)!).getByRole('checkbox', { name: 'Anna' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it('shows one disabled row with no players connected', async () => {
    const panel = await hostSplit([]);
    fireEvent.click(presentTo(panel));
    expect((within(popover(panel)!).getByRole('checkbox', { name: 'No players connected' }) as HTMLInputElement).disabled).toBe(true);
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

  it('Everyone back in the popover is disabled with nothing presented (D9)', async () => {
    harness.host([anna, ben]);
    split({ p2: 'dungeon' });
    const panel = within(await harness.openPanel());
    expect((panel.getByRole('button', { name: 'Everyone back to the presented scene' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(presentTo(panel));
    const back = within(popover(panel)!).getByRole('button', { name: 'Everyone back to the presented scene' }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
  });

  it('states the cap at four scenes and notes it in the popover', async () => {
    harness.service.wouldExceedCap.mockImplementation(() => true);
    const panel = await hostSplit([anna, ben], {});
    split({ p2: 'dungeon' }, 4);
    expect(panel.getByText('Players are on 4 scenes, the most at once. Bring players back to free one.')).toBeTruthy();
    act(() => { harness.scene.tabs.getState().setActiveTab(harness.scene.tabs.getState().addTab('maps/fifth.atlasmap', 'Fifth')); });
    fireEvent.click(presentTo(panel));
    const group = within(popover(panel)!);
    expect(group.getByText('At most 4 scenes at once')).toBeTruthy();
    expect((group.getByRole('checkbox', { name: 'Anna · on Tavern' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('without scene-tabs shows the update note and no Present to button', async () => {
    harness.gm();
    harness = gmUiHarness();
    harness.host([anna]);
    harness.present(harness.scene.view, harness.scene.tavern);
    const panel = within(await harness.openPanel());
    expect(panel.getByText('Update Atlas VTT to show different scenes to different players.')).toBeTruthy();
    expect(panel.queryByRole('button', { name: /^Present to:/ })).toBeNull();
  });

  it('disabled and reads Present to: no scene open without a map view', async () => {
    const panel = await hostSplit([anna]);
    act(() => {
      harness.scene.tabs.getState().removeTab(harness.scene.dungeon);
      harness.scene.tabs.getState().removeTab(harness.scene.tavern);
    });
    expect(presentTo(panel).textContent).toBe('Present to: no scene open');
    expect(presentTo(panel).disabled).toBe(true);
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
