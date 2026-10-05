import { useEffect, useReducer, useSyncExternalStore } from 'react';
import type { ViewId, ViewsApi } from '@atlas-vtt/api-types';
import type { TokenControl } from '../control/TokenControl';
import { onlineSessionStore, type OnlineSessionState } from '../onlineSessionStore';
import type { PresentedSceneSummaries, PresentedSceneSummary } from '../ui/presentedSceneSummary';

/** The online session as the GM's UI sees it. */
export function useOnlineSession(): OnlineSessionState {
  return useSyncExternalStore(onlineSessionStore.subscribe, onlineSessionStore.getState);
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

/** Renders again whenever the view's store changes what a snapshot holds, which a tab switch does. */
export function useViewChanges(views: Pick<ViewsApi, 'subscribe'>, viewId: ViewId): void {
  const [, refresh] = useReducer((version: number) => version + 1, 0);
  useEffect(() => views.subscribe(viewId, () => refresh()), [views, viewId]);
}
