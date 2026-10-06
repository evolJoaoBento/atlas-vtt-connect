import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import type { TabKey } from '../../../src/app/online/split/tabKey';
import { anna, ben, dan, gmUiHarness, type GmUiHarness } from './gmUiFixtures';

let harness: GmUiHarness;

function split(assignments: Record<string, string>, scenesInUse = 1 + new Set(Object.values(assignments)).size): void {
  const tabs: Record<string, TabKey> = Object.fromEntries(Object.entries(assignments).map(([playerId, tabId]) => [playerId, { viewId: harness.scene.view, tabId }]));
  act(() => { onlineSessionStore.setState({ split: 'on', assignments: tabs, assignedCount: Object.keys(tabs).length, scenesInUse }); });
}

const labels = (tabId: string): string[] => harness.ui.sceneTabMenu(harness.scene.view, tabId).map((item) => item.label);

beforeEach(() => {
  harness = gmUiHarness({ capabilities: ['scene-tabs'] });
});
afterEach(() => {
  harness.gm();
  cleanup();
  act(() => { resetOnlineSessionStore(); });
});

describe('the eye\'s Present to section (spec 3.3)', () => {
  it('adds the section only while hosting', () => {
    expect(harness.ui.sceneTabSectionCount()).toBe(0);
    harness.host([anna]);
    split({});
    expect(harness.ui.sceneTabSectionCount()).toBe(1);
    expect(harness.ui.sceneTabMenuSections(harness.scene.view, 'dungeon').map((section) => section.heading)).toEqual(['Present to']);
    act(() => { resetOnlineSessionStore(); });
    expect(harness.ui.sceneTabSectionCount()).toBe(0);
    expect(harness.ui.sceneTabMenu(harness.scene.view, 'dungeon')).toEqual([]);
  });

  it('adds none on an Atlas whose split party is off, and none once the GM UI is gone', () => {
    harness.host([anna]);
    expect(harness.ui.sceneTabSectionCount()).toBe(0);
    split({});
    harness.gm();
    expect(harness.ui.sceneTabSectionCount()).toBe(0);
  });

  it('lists players for the right-clicked tab with the 3.4 labels', () => {
    harness.host([anna, ben, dan]);
    harness.present(harness.scene.view, harness.scene.tavern);
    split({ p2: 'dungeon' });
    expect(labels('tavern')).toEqual(['Anna', 'Ben · on Dungeon', 'Dan · disconnected', 'Everyone back to the presented scene']);
    const items = harness.ui.sceneTabMenu(harness.scene.view, 'dungeon');
    expect(items.map((item) => item.label)).toEqual(['Anna · on Tavern', 'Ben', 'Dan · on Tavern · disconnected', 'Everyone back to the presented scene']);
    expect(items.slice(0, 3).map((item) => [item.checked, item.disabled, item.keepOpen])).toEqual([[false, false, true], [true, false, true], [false, false, true]]);
    expect(items[3]).toMatchObject({ disabled: false });
    expect(items[3]!.keepOpen).toBeUndefined();
    const tavern = harness.ui.sceneTabMenu(harness.scene.view, 'tavern');
    expect(tavern[0]).toMatchObject({ checked: true, disabled: true });
  });

  it('runs the rows through the service and stays open, Everyone back closes it', () => {
    harness.host([anna, ben]);
    harness.present(harness.scene.view, harness.scene.tavern);
    split({ p2: 'dungeon' });
    const menu = harness.ui.openSceneTabMenu(harness.scene.view, 'dungeon');
    expect(menu.choose('Anna · on Tavern')).toBe(true);
    expect(harness.service.assign).toHaveBeenCalledWith('p1', { viewId: harness.scene.view, tabId: 'dungeon' });
    expect(menu.choose('Ben')).toBe(true);
    expect(harness.service.unassign).toHaveBeenCalledWith('p2');
    expect(menu.isOpen).toBe(true);
    expect(menu.choose('Everyone back to the presented scene')).toBe(true);
    expect(harness.service.everyoneBack).toHaveBeenCalledOnce();
    expect(menu.isOpen).toBe(false);
  });

  it('notes the cap in a disabled first row, and shows one disabled row with no players', () => {
    harness.service.wouldExceedCap.mockImplementation(() => true);
    harness.host([anna]);
    harness.present(harness.scene.view, harness.scene.tavern);
    split({}, 4);
    expect(harness.ui.sceneTabMenu(harness.scene.view, 'dungeon').slice(0, 2)).toEqual([
      expect.objectContaining({ label: 'At most 4 scenes at once', disabled: true }),
      expect.objectContaining({ label: 'Anna · on Tavern', disabled: true }),
    ]);
    act(() => { onlineSessionStore.setState({ players: [] }); });
    expect(harness.ui.sceneTabMenu(harness.scene.view, 'dungeon').map((item) => [item.label, item.disabled])).toEqual([
      ['No players connected', true], ['Everyone back to the presented scene', true],
    ]);
  });

  it('the open menu\'s checkmarks follow the store', () => {
    harness.host([anna]);
    harness.present(harness.scene.view, harness.scene.tavern);
    split({});
    const menu = harness.ui.openSceneTabMenu(harness.scene.view, 'dungeon');
    expect(menu.items[0]).toMatchObject({ label: 'Anna · on Tavern', checked: false });
    split({ p1: 'dungeon' });
    expect(menu.items[0]).toMatchObject({ label: 'Anna', checked: true });
  });
});
