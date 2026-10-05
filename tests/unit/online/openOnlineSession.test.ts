import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';

const { openOnlineSessionModal } = vi.hoisted(() => ({ openOnlineSessionModal: vi.fn() }));

vi.mock('../../../src/app/online/ui/OnlineSessionModal', () => ({ openOnlineSessionModal }));

import { openOnlineSession } from '../../../src/app/online/ui/openOnlineSession';
import { emptySceneState, sceneView } from './presentedFixtures';
import { gmUiHarness, type GmUiHarness } from './gmUiFixtures';

/** The workspace's leaves: Atlas map views carry their `viewId`. */
function appWith(viewIds: string[]): { app: App; revealLeaf: ReturnType<typeof vi.fn>; leaves: Array<{ view: { viewId: string } }> } {
  const leaves = viewIds.map((viewId) => ({ view: { viewId } }));
  const revealLeaf = vi.fn(() => Promise.resolve());
  const app = { workspace: { iterateAllLeaves: (callback: (leaf: unknown) => void) => leaves.forEach(callback), revealLeaf } } as unknown as App;
  return { app, revealLeaf, leaves };
}

let harness: GmUiHarness;

beforeEach(() => {
  vi.clearAllMocks();
  harness = gmUiHarness();
});
afterEach(() => { harness.gm(); });

/** A second map view. */
function secondView(): string {
  return sceneView(harness, emptySceneState()).view;
}

describe('Online session… command', () => {
  // Review Focus
  it('opens the panel only in the active view, else the first open one, else the modal', () => {
    const first = harness.scene.view;
    const second = secondView();
    harness.atlas.views.setActive(second);
    const active = appWith([first, second]);
    openOnlineSession(active.app, harness.gm);
    expect(harness.ui.panelContainer('online', second)).not.toBeNull();
    expect(harness.ui.panelContainer('online', first)).toBeNull();
    expect(active.revealLeaf).not.toHaveBeenCalled();
    harness.ui.closePanel('online', second);

    harness.atlas.views.setActive(null);
    const inactive = appWith([first, second]);
    openOnlineSession(inactive.app, harness.gm);
    expect(harness.ui.panelContainer('online', first)).not.toBeNull();
    expect(inactive.revealLeaf).toHaveBeenCalledWith(inactive.leaves[0]);
    expect(openOnlineSessionModal).not.toHaveBeenCalled();
  });

  it('never picks a remote view (API 1.12.0): the first GM map view gets the panel, and with only a remote view open the modal', () => {
    harness.atlas.views.close(harness.scene.view);
    harness.atlas.views.openRemote('remote-1');
    harness.atlas.views.setActive('remote-1');
    openOnlineSession(appWith(['remote-1']).app, harness.gm);
    expect(harness.ui.panelContainer('online', 'remote-1')).toBeNull();
    expect(openOnlineSessionModal).toHaveBeenCalledOnce();
    // Listed after the remote view: a pick that ignored the kind would take the remote one.
    const gmView = secondView();
    openOnlineSession(appWith(['remote-1', gmView]).app, harness.gm);
    expect(harness.ui.panelContainer('online', gmView)).not.toBeNull();
    expect(harness.ui.panelContainer('online', 'remote-1')).toBeNull();
  });

  it("offers nothing of online play in a remote view's menu, palette or toolbar", () => {
    harness.atlas.views.openRemote('remote-1');
    expect(harness.ui.viewMenu('remote-1')).toEqual([]);
    expect(harness.ui.palette('remote-1')).toEqual([]);
    expect(harness.ui.drawToolbar('remote-1')).toEqual([]);
    expect(harness.ui.viewMenu(harness.scene.view).length).toBeGreaterThan(0);
  });

  it('opens the modal when no map view is open', () => {
    harness.atlas.views.close(harness.scene.view);
    const { app } = appWith([]);
    openOnlineSession(app, harness.gm);
    expect(openOnlineSessionModal).toHaveBeenCalledOnce();
    expect(openOnlineSessionModal).toHaveBeenCalledWith(app);
  });

  it('opens the modal without Atlas UI slots', () => {
    const { app } = appWith([]);
    openOnlineSession(app);
    expect(openOnlineSessionModal).toHaveBeenCalledWith(app);
  });
});
