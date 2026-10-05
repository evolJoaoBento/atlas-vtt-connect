import type { PresentationApi, ViewContext, ViewsApi } from '@atlas-vtt/api-types';
import type { PresentedSceneSummaries } from '../ui/presentedSceneSummary';

export interface PresentingEnv {
  presentation: Pick<PresentationApi, 'current' | 'present' | 'stop'>;
  views: Pick<ViewsApi, 'list' | 'subscribe'>;
  summaries: PresentedSceneSummaries;
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
