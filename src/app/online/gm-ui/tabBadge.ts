/**
 * The mark after a scene tab's eye while the party is split (spec 3.7, Atlas API 1.17.0 `PresentationTarget.tabBadge`):
 * "2 players", how many players see that tab. Atlas reads it once at `addTarget` and calls it on every render and after
 * `ui.invalidate()`, so it reads the session store at call time.
 */
import type { PresentationApi } from '@atlas-vtt/api-types';
import { onlineSessionStore } from '../onlineSessionStore';
import { splitShown, splitViewOf, tabBadgeText } from './presentToRows';

/** The badge for a tab: null while not hosting, with nobody assigned, or with nobody on that tab. */
export function tabBadge(presentation: Pick<PresentationApi, 'current'>): (tab: { viewId: string; tabId: string }) => string | null {
  return (tab) => {
    const state = onlineSessionStore.getState();
    if (!splitShown(state)) return null;
    // The badge counts players; it never shows a scene's name.
    return tabBadgeText(splitViewOf(state, presentation, () => ''), { viewId: tab.viewId, tabId: tab.tabId });
  };
}
