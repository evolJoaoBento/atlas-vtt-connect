import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { OnlineSessionService } from '../../../src/app/online/OnlineSessionService';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { tabScene, TABS } from '../online/splitFixtures';
import { connected, HOSTING } from './hostingFixtures';

const SPLIT: AtlasCapability[] = [...HOSTING, 'scene-tabs', 'ui'];
const VIEW = 'gm';

/** Connect hosting on an Atlas with scene tabs, the GM's view on Ambush (presented), Ana and Ben admitted. */
async function hosting(capabilities = SPLIT) {
  const world = connected(capabilities);
  const { atlas, connect } = world;
  atlas.views.open(VIEW, TABS.map((entry) => ({ ...entry })));
  atlas.views.setActive(VIEW);
  for (const { tabId } of TABS.slice(1)) atlas.views.setTabScene(VIEW, tabId, tabScene(tabId));
  atlas.views.setSnapshot(VIEW, tabScene('a'));
  await vi.advanceTimersByTimeAsync(0);
  expect(connect.run('start-online-session')).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  await atlas.presentation.present(VIEW, 'a');
  const ana = await world.join('Ana');
  const ben = await world.join('Ben');
  await vi.advanceTimersByTimeAsync(60);
  const service = OnlineSessionService.forApp(connect.plugin.app)!;
  const idOf = (name: string): string => onlineSessionStore.getState().players.find((player) => player.name === name)!.playerId;
  return { ...world, service, ana, ben, idOf };
}

describe('the split party while hosting', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

  it('turns on with scene tabs, and the Obsidian command brings everyone back', async () => {
    const { connect, service, ben, idOf } = await hosting();
    expect(onlineSessionStore.getState()).toMatchObject({ split: 'on', assignedCount: 0, scenesInUse: 1 });
    expect(connect.run('everyone-back')).toBe(false);
    service.assign(idOf('Ben'), { viewId: VIEW, tabId: 'b' });
    await vi.advanceTimersByTimeAsync(60);
    expect(onlineSessionStore.getState()).toMatchObject({ assignedCount: 1, scenesInUse: 2, assignments: { [idOf('Ben')]: { viewId: VIEW, tabId: 'b' } } });
    const from = ben.received.length;
    expect(connect.run('everyone-back')).toBe(true);
    await vi.advanceTimersByTimeAsync(60);
    expect(onlineSessionStore.getState().assignedCount).toBe(0);
    expect(ben.received.slice(from).map((message) => message.type).filter((type) => type.startsWith('scene-')).slice(0, 2)).toEqual(['scene-clear', 'scene-snapshot']);
  });

  it('stays off on an Atlas without scene tabs: no command, assigning does nothing', async () => {
    const { connect, service, idOf } = await hosting([...HOSTING, 'ui']);
    expect(onlineSessionStore.getState().split).toBe('unsupported');
    expect(connect.commands.has('everyone-back')).toBe(false);
    service.assign(idOf('Ben'), { viewId: VIEW, tabId: 'b' });
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineSessionStore.getState().assignedCount).toBe(0);
  });
});

describe('the eye while hosting', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

  it('ticking on a never-live tab switches the GM view and the row turns checked after invalidate', async () => {
    const { atlas, ben } = await hosting();
    const menu = atlas.ui!.openSceneTabMenu(VIEW, 'c');
    const from = ben.received.length;
    expect(menu.choose('Ben · on Ambush')).toBe(true);
    await vi.advanceTimersByTimeAsync(60);
    expect(atlas.views.tabsOf(VIEW)?.activeTabId).toBe('c');
    expect(atlas.presentation.current()).toMatchObject({ tabId: 'a' });
    expect(menu.isOpen).toBe(true);
    expect(menu.items.find((item) => item.label === 'Ben')).toMatchObject({ checked: true });
    expect(menu.items.find((item) => item.label === 'Ana · on Ambush')).toMatchObject({ checked: false });
    const sent = ben.received.slice(from).filter((message) => message.type === 'scene-snapshot');
    expect(sent.length).toBeGreaterThan(0);
    expect(JSON.stringify(sent)).toContain('cavebat');
  });

  it('badges the tabs players see while split, and leaves no section and no badge once hosting stops', async () => {
    const { atlas, connect, service, idOf } = await hosting();
    expect(atlas.ui!.sceneTabSectionCount()).toBe(1);
    expect(atlas.presentation.badgeFor(VIEW, 'a')).toBeNull();
    service.assign(idOf('Ben'), { viewId: VIEW, tabId: 'b' });
    await vi.advanceTimersByTimeAsync(60);
    expect(atlas.presentation.badgeFor(VIEW, 'a')).toBe('1 player');
    expect(atlas.presentation.badgeFor(VIEW, 'b')).toBe('1 player');
    expect(atlas.presentation.badgeFor(VIEW, 'c')).toBeNull();
    expect(connect.run('stop-online-session')).toBe(true);
    expect(atlas.ui!.sceneTabSectionCount()).toBe(0);
    expect(atlas.presentation.badgeFor(VIEW, 'b')).toBeNull();
    expect(atlas.ui!.sceneTabMenu(VIEW, 'b')).toEqual([]);
  });
});
