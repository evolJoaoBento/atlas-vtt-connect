import type { App, WorkspaceLeaf } from 'obsidian';

/** The Canvas 2D scene tab: the presented scene of a session joined from Obsidian. */
export const ONLINE_SCENE_VIEW_TYPE = 'atlas-vtt-connect-scene';
export const ONLINE_SCENE_TITLE = 'Online scene';

/**
 * Opens the scene tab in a new tab, or shows the one already open. While its window is hidden (the player tabbed
 * away while the GM let them in), the tab opens in the background and is shown once the window is back: an active
 * leaf focuses the window, which then comes forward still marked hidden and paints nothing (its old frame, the Join
 * dialog, stays on screen) until the player clicks elsewhere.
 */
export async function openOnlineSceneTab(app: App): Promise<void> {
  const open = app.workspace.getLeavesOfType(ONLINE_SCENE_VIEW_TYPE)[0];
  const leaf = open ?? app.workspace.getLeaf('tab');
  const doc = leaf.view.containerEl.ownerDocument;
  if (doc.hidden) {
    if (!open) await leaf.setViewState({ type: ONLINE_SCENE_VIEW_TYPE, active: false });
    revealWhenShown(app, leaf, doc);
    return;
  }
  if (!open) await leaf.setViewState({ type: ONLINE_SCENE_VIEW_TYPE, active: true });
  await app.workspace.revealLeaf(leaf);
}

/** Shows the leaf the first time its window is visible again, unless it was closed meanwhile. */
function revealWhenShown(app: App, leaf: WorkspaceLeaf, doc: Document): void {
  const onVisible = (): void => {
    if (doc.hidden) return;
    doc.removeEventListener('visibilitychange', onVisible);
    if (app.workspace.getLeavesOfType(ONLINE_SCENE_VIEW_TYPE).includes(leaf)) void app.workspace.revealLeaf(leaf);
  };
  doc.addEventListener('visibilitychange', onVisible);
}
