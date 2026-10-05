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

/** A second map view, drawn as a GM view (the toolbar was drawn in it). */
function secondView(): string {
  const second = sceneView(harness, emptySceneState());
  harness.ui.drawToolbar(second.view);
  return second.view;
}

describe('Online session… command', () => {
  // Review Focus
  it('opens the panel only in the active view, else the first open one, else the modal', () => {
    const first = harness.scene.view;
    const second = secondView();
    harness.ui.drawToolbar(first);
    harness.atlas.views.setActive(second);
    const active = appWith([first, second]);
    openOnlineSession(active.app, harness.gm);
    expect(harness.ui.panelContainer('online', second)).not.toBeNull();
    expect(harness.ui.panelContainer('online', first)).toBeNull();
    expect(active.revealLeaf).not.toHaveBeenCalled();
    harness.ui.clickToolbar('online', second);

    harness.atlas.views.setActive(null);
    const inactive = appWith([first, second]);
    openOnlineSession(inactive.app, harness.gm);
    expect(harness.ui.panelContainer('online', first)).not.toBeNull();
    expect(inactive.revealLeaf).toHaveBeenCalledWith(inactive.leaves[0]);
    expect(openOnlineSessionModal).not.toHaveBeenCalled();
  });

  it('opens the modal when no GM view is open', () => {
    harness.atlas.views.setActive(null);
    const { app } = appWith([]);
    openOnlineSession(app, harness.gm);
    expect(openOnlineSessionModal).toHaveBeenCalledOnce();
    expect(openOnlineSessionModal).toHaveBeenCalledWith(app);
  });

  it('opens the modal for a view that does not show GM panels', () => {
    harness.ui.markPlayerView(harness.scene.view);
    harness.ui.drawToolbar(harness.scene.view); // a player view draws no slot, so Connect never sees it as a GM view
    openOnlineSession(appWith([harness.scene.view]).app, harness.gm);
    expect(harness.ui.panelContainer('online', harness.scene.view)).toBeNull();
    expect(openOnlineSessionModal).toHaveBeenCalledOnce();
  });

  it('opens the modal without Atlas UI slots', () => {
    const { app } = appWith([]);
    openOnlineSession(app);
    expect(openOnlineSessionModal).toHaveBeenCalledWith(app);
  });

  it('opens the panel in a view once the view has drawn its toolbar, whichever is active', () => {
    expect(harness.gm.openPanel(appWith([]).app)).toBe(false);
    harness.ui.drawToolbar(harness.scene.view);
    expect(harness.gm.openPanel(appWith([harness.scene.view]).app)).toBe(true);
    expect(harness.ui.panelContainer('online', harness.scene.view)).not.toBeNull();
  });
});
