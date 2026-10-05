/** The Atlas dashboard's "Join online session" tile opens the Join dialog, as the command does (API `ui`). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from 'obsidian';
import { connected } from '../../connect/hostingFixtures';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the dashboard join tile', () => {
  it('opens the Join dialog from the dashboard, with its title and description', async () => {
    const open = vi.spyOn(Modal.prototype, 'open');
    const { atlas, connect } = connected(['ui']);
    await vi.advanceTimersByTimeAsync(0);
    expect(atlas.ui!.dashboardTiles()).toEqual([
      { id: 'join-online-session', icon: 'log-in', title: 'Join online session', description: "Paste a GM's link to play", onClick: expect.any(Function) },
    ]);
    atlas.ui!.dashboardTiles()[0]!.onClick();
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.contexts[0]).toMatchObject({ app: connect.plugin.app });
    atlas.unload();
  });

  it('is gated on ui only: no hosting capability is needed, and an Atlas without ui has no tile', async () => {
    const withUi = connected(['ui']);
    await vi.advanceTimersByTimeAsync(0);
    expect(withUi.atlas.ui!.counts().dashboard).toBe(1);
    withUi.atlas.unload();
    expect(withUi.atlas.ui!.counts().dashboard).toBe(0);

    const without = connected([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(without.atlas.ui).toBeUndefined();
    expect(without.connect.run('join-online-session')).toBe(true);
    without.atlas.unload();
  });
});
