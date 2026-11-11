import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabScenes } from '../../../src/app/online/atlas/tabScenes';
import { assignToTab, READ_TAB_MS } from '../../../src/app/online/scene/splitActions';
import type { SceneSlot } from '../../../src/app/online/scene/SceneSlot';
import { SceneAssignments } from '../../../src/app/online/split/SceneAssignments';
import type { TabKey } from '../../../src/app/online/split/tabKey';

const TAVERN: TabKey = { viewId: 'gm', tabId: 'tavern' };
const CELLAR: TabKey = { viewId: 'gm', tabId: 'cellar' };

/** Atlas's tabs with the GM on the tavern; `elsewhere`: the GM works on Tabletop's board, not in Atlas's view. */
function world(elsewhere: boolean, options: { projects?: boolean } = {}) {
  let active = 'tavern';
  const slot = { lastSent: null as unknown, disposed: false, name: 'The Cellar' };
  const shown: string[] = [];
  const tabs = {
    isActive: (key: TabKey) => key.tabId === active,
    tab: (key: TabKey) => ({ ...key, mapPath: `${key.tabId}.atlasmap`, name: key.tabId }),
    returnTab: (key: TabKey) => (elsewhere && key.tabId !== active ? { viewId: key.viewId, tabId: active } : null),
    show: vi.fn(async (key: TabKey) => {
      active = key.tabId;
      shown.push(key.tabId);
      // The cellar's first picture is sent once it is loaded.
      if (key.tabId === 'cellar' && options.projects !== false) window.setTimeout(() => { slot.lastSent = {}; }, 120);
      return true;
    }),
  } as unknown as TabScenes;
  const assignments = new SceneAssignments();
  const deps = { tabs, assignments, presented: () => TAVERN, slotAt: () => slot as unknown as SceneSlot, notify: vi.fn() };
  return { deps, shown, active: () => active, move: (tabId: string) => { active = tabId; } };
}

describe('Present to a tab Atlas does not hold', () => {
  afterEach(() => { vi.useRealTimers(); });

  it("from Tabletop's board: Atlas reads the tab, then goes back to the tab the GM was on", async () => {
    vi.useFakeTimers();
    const w = world(true);
    const result = assignToTab(w.deps, 'kestrel', CELLAR);
    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBe('ok');
    expect(w.shown).toEqual(['cellar', 'tavern']);
    expect(w.active()).toBe('tavern');
    expect(w.deps.assignments.tabOf('kestrel')).toEqual(CELLAR);
  });

  it('goes back after a while even when no picture came, but not when the GM moved to another tab meanwhile', async () => {
    vi.useFakeTimers();
    const slow = world(true, { projects: false });
    const first = assignToTab(slow.deps, 'kestrel', CELLAR);
    await vi.advanceTimersByTimeAsync(READ_TAB_MS + 100);
    await first;
    expect(slow.active()).toBe('tavern');
    const moved = world(true, { projects: false });
    const second = assignToTab(moved.deps, 'kestrel', CELLAR);
    await vi.advanceTimersByTimeAsync(100);
    moved.move('den');
    await vi.advanceTimersByTimeAsync(READ_TAB_MS);
    await second;
    expect(moved.shown).toEqual(['cellar']);
    expect(moved.active()).toBe('den');
  });

  it("from Atlas's own view: the GM follows the switch, as before (D4)", async () => {
    vi.useFakeTimers();
    const w = world(false);
    const result = assignToTab(w.deps, 'kestrel', CELLAR);
    await vi.advanceTimersByTimeAsync(200);
    await result;
    expect(w.shown).toEqual(['cellar']);
    expect(w.active()).toBe('cellar');
  });
});
