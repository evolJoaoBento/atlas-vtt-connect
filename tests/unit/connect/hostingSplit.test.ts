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
