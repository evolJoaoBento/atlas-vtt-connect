import type { PresentationApi, ViewContext, ViewsApi } from '@atlas-vtt/api-types';
import type { PresentedSceneSummaries } from '../ui/presentedSceneSummary';

export interface PresentingEnv {
  presentation: Pick<PresentationApi, 'current' | 'present' | 'stop'>;
  views: Pick<ViewsApi, 'list' | 'subscribe'>;
  summaries: PresentedSceneSummaries;
  /** Atlas's 'tabs-changed' (API 1.17.0): a tab renamed, added or closed, which `views.subscribe` does not tell. */
  tabsChanged?: (listener: () => void) => () => void;
}

/** What the "Present to players" and "Stop presenting" entries of a view's menus and panel offer now. */
export function presentingActions(env: { presentation: Pick<PresentationApi, 'current'>; views: Pick<ViewsApi, 'list'> }, ctx: ViewContext): { present: boolean; stop: boolean } {
  const { activeTabId, presentedHere } = presentingHere(env, ctx.viewId);
  return { present: activeTabId !== null && presentedHere !== activeTabId, stop: env.presentation.current() !== null };
}

/** The tab this view shows now, and the tab of this view that players see (null when they see another view's). */
export function presentingHere(env: { presentation: Pick<PresentationApi, 'current'>; views: Pick<ViewsApi, 'list'> }, viewId: string): { activeTabId: string | null; presentedHere: string | null } {
  const activeTabId = env.views.list().find((view) => view.viewId === viewId)?.activeTabId ?? null;
  const current = env.presentation.current();
  return { activeTabId, presentedHere: current?.viewId === viewId ? current.tabId : null };
}

/** A tab's name as its tab bar shows it; empty for a tab no longer open. */
export function tabNameIn(views: Pick<ViewsApi, 'list'>, tab: { viewId: string; tabId: string }): string {
  return views.list().find((view) => view.viewId === tab.viewId)?.tabs.find((entry) => entry.tabId === tab.tabId)?.name ?? '';
}
