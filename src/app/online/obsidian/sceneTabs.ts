import type { App } from 'obsidian';
import { openOnlineSceneTab } from './onlineSceneTab';

/**
 * Opens the tab that shows the joined session. Atlas's remote view (API 1.12, plan B15) will be the player's view
 * when this Atlas has the `remote-view` capability; until it is vendored, and on every Atlas without it, the tab
 * is Connect's own Canvas 2D scene (`CanvasSceneView`).
 */
export function openSceneTab(app: App): Promise<void> {
  return openOnlineSceneTab(app);
}
