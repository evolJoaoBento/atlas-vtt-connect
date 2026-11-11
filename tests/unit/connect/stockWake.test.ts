import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { loadDeferredLeaves, wakeAtlasForHosting, type HostingWakeDeps } from '../../../src/connect/stockWake';

function workspace(leaves: Array<{ isDeferred?: boolean; loadIfDeferred?: () => Promise<void> }>, recent: unknown) {
  let active = recent;
  const setActiveLeaf = vi.fn((leaf: unknown) => { active = leaf; });
  const app = { workspace: { getLeavesOfType: () => leaves, getMostRecentLeaf: () => active, setActiveLeaf } } as unknown as App;
  return { app, setActiveLeaf, active: () => active, makeActive: (leaf: unknown) => { active = leaf; } };
}

describe("waking Atlas's deferred map tab for online play", () => {
  it('loads only deferred leaves, and leaves the GM on their own tab', async () => {
    const board = { name: 'tabletop board' };
    const deferred = { isDeferred: true, loadIfDeferred: vi.fn(async () => { w.makeActive(deferred); }) };
    const shown = { isDeferred: false, loadIfDeferred: vi.fn(async () => undefined) };
    const w = workspace([deferred, shown], board);
    await expect(loadDeferredLeaves(w.app, 'atlas-vtt')).resolves.toBe(true);
    expect(deferred.loadIfDeferred).toHaveBeenCalledTimes(1);
    expect(shown.loadIfDeferred).not.toHaveBeenCalled();
    expect(w.setActiveLeaf).toHaveBeenCalledWith(board, { focus: false });
    expect(w.active()).toBe(board);
    await expect(loadDeferredLeaves(workspace([shown], board).app, 'atlas-vtt')).resolves.toBe(false);
  });

  function hosting(woke = true, loaded = true) {
    let state = { status: 'idle', players: [] as Array<{ status: string }> };
    const listeners = new Set<() => void>();
    const deps: HostingWakeDeps = {
      state: () => state,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      wake: vi.fn(async () => woke),
      hasLoadedView: vi.fn(() => false),
      waitForLoadedView: vi.fn(async () => loaded),
      ensurePresented: vi.fn(async () => undefined),
    };
    const stop = wakeAtlasForHosting(deps);
    const set = (next: typeof state): void => { state = next; for (const listener of [...listeners]) listener(); };
    return { deps, set, stop };
  }

  it('wakes the tab when hosting starts, then makes sure a scene is presented', async () => {
    const h = hosting();
    expect(h.deps.wake).not.toHaveBeenCalled();
    h.set({ status: 'hosting', players: [] });
    await vi.waitFor(() => expect(h.deps.ensurePresented).toHaveBeenCalledTimes(1));
    expect(h.deps.wake).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('presents nothing when no tab had to be woken, or the woken one never loads', async () => {
    for (const [woke, loaded] of [[false, true], [true, false]] as const) {
      const h = hosting(woke, loaded);
      h.set({ status: 'hosting', players: [] });
      await vi.waitFor(() => expect(h.deps.wake).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      await Promise.resolve();
      expect(h.deps.ensurePresented).not.toHaveBeenCalled();
      h.stop();
    }
  });

  it('wakes it again when a player comes in and there is still no loaded view', async () => {
    const h = hosting(false);
    h.set({ status: 'hosting', players: [] });
    h.set({ status: 'hosting', players: [{ status: 'pending' }] });
    expect(h.deps.wake).toHaveBeenCalledTimes(1);
    h.set({ status: 'hosting', players: [{ status: 'admitted' }] });
    expect(h.deps.wake).toHaveBeenCalledTimes(2);
    h.stop();
  });
});
