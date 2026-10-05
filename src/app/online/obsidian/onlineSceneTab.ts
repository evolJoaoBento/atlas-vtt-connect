import type { App } from 'obsidian';

/** The Canvas 2D scene tab: the presented scene of a session joined from Obsidian. */
export const ONLINE_SCENE_VIEW_TYPE = 'atlas-vtt-connect-scene';
export const ONLINE_SCENE_TITLE = 'Online scene';

/** Opens the scene tab in a new tab, or shows the one already open. */
export async function openOnlineSceneTab(app: App): Promise<void> {
  const open = app.workspace.getLeavesOfType(ONLINE_SCENE_VIEW_TYPE)[0];
  if (open) {
    await app.workspace.revealLeaf(open);
    return;
  }
  const leaf = app.workspace.getLeaf('tab');
  await leaf.setViewState({ type: ONLINE_SCENE_VIEW_TYPE, active: true });
  await app.workspace.revealLeaf(leaf);
}
