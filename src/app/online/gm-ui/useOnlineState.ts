import { useCallback, useEffect, useReducer, useSyncExternalStore } from 'react';
import type { ViewId, ViewsApi } from '@atlas-vtt/api-types';
import type { TokenControl } from '../control/TokenControl';
import { isInSession, joinedSessionStore } from '../obsidian/joinedSessionStore';
import { onlineSessionStore, type OnlineSessionState } from '../onlineSessionStore';
import type { PresentedSceneSummaries, PresentedSceneSummary } from '../ui/presentedSceneSummary';

/** The online session as the GM's UI sees it. */
export function useOnlineSession(): OnlineSessionState {
  return useSyncExternalStore(onlineSessionStore.subscribe, onlineSessionStore.getState);
}

/** Whether this Obsidian is in an online session it joined (connecting, waiting or admitted). */
export function useInJoinedSession(): boolean {
  return useSyncExternalStore(joinedSessionStore.subscribe, () => isInSession(joinedSessionStore.getState()));
}

/** The presented scene: its tab, name and characters. */
export function usePresentedSceneSummary(summaries: PresentedSceneSummaries): PresentedSceneSummary {
  return useSyncExternalStore(summaries.subscribe, summaries.read);
}

/** Renders again whenever the session's token assignments change. */
export function useTokenControlVersion(control: TokenControl | null): void {
  const [, refresh] = useReducer((version: number) => version + 1, 0);
  useEffect(() => control?.onChange(() => refresh()), [control]);
}

/** The tab the view shows; renders again only when it changes, not on every store change (a token drag). */
export function useActiveTabId(views: Pick<ViewsApi, 'list' | 'subscribe'>, viewId: ViewId): string | null {
  const subscribe = useCallback((onChange: () => void) => views.subscribe(viewId, onChange), [views, viewId]);
  const read = useCallback(() => views.list().find((view) => view.viewId === viewId)?.activeTabId ?? null, [views, viewId]);
  return useSyncExternalStore(subscribe, read);
}
