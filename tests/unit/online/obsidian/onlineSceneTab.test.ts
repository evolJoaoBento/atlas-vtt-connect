import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { ONLINE_SCENE_VIEW_TYPE, openOnlineSceneTab } from '../../../../src/app/online/obsidian/onlineSceneTab';

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

function fakeApp() {
  const leaves: Array<{ type: string | null; view: { containerEl: HTMLElement }; setViewState: ReturnType<typeof vi.fn> }> = [];
  const revealLeaf = vi.fn(() => Promise.resolve());
  const getLeaf = vi.fn(() => {
    const leaf = {
      type: null as string | null,
      view: { containerEl: document.createElement('div') },
      setViewState: vi.fn((state: { type: string }) => { leaf.type = state.type; return Promise.resolve(); }),
    };
    leaves.push(leaf);
    return leaf;
  });
  const app = {
    workspace: { getLeaf, revealLeaf, getLeavesOfType: (type: string) => leaves.filter((leaf) => leaf.type === type) },
  } as unknown as App;
  return { app, leaves, revealLeaf };
}

describe('Opening the online scene tab', () => {
  afterEach(() => { setHidden(false); });

  it('opens it active and shows it while the window is visible', async () => {
    const { app, leaves, revealLeaf } = fakeApp();
    await openOnlineSceneTab(app);
    expect(leaves[0]!.setViewState).toHaveBeenCalledWith({ type: ONLINE_SCENE_VIEW_TYPE, active: true });
    expect(revealLeaf).toHaveBeenCalledWith(leaves[0]);
  });

  it('opens it in the background while the window is hidden, and shows it once the window is back', async () => {
    setHidden(true);
    const { app, leaves, revealLeaf } = fakeApp();
    await openOnlineSceneTab(app);
    // An active leaf would focus the hidden window, which then paints nothing until the player clicks elsewhere.
    expect(leaves[0]!.setViewState).toHaveBeenCalledWith({ type: ONLINE_SCENE_VIEW_TYPE, active: false });
    expect(revealLeaf).not.toHaveBeenCalled();
    setHidden(true);
    expect(revealLeaf).not.toHaveBeenCalled();
    setHidden(false);
    expect(revealLeaf).toHaveBeenCalledExactlyOnceWith(leaves[0]);
    setHidden(true);
    setHidden(false);
    expect(revealLeaf).toHaveBeenCalledTimes(1);
  });

  it('does not show a tab closed while the window was hidden', async () => {
    setHidden(true);
    const { app, leaves, revealLeaf } = fakeApp();
    await openOnlineSceneTab(app);
    leaves[0]!.type = null;
    setHidden(false);
    expect(revealLeaf).not.toHaveBeenCalled();
  });
});
