import type { PresentationApi, ViewsApi } from '@atlas-vtt/api-types';
import type { PresentedSceneSummaries } from '../ui/presentedSceneSummary';

export interface PresentingEnv {
  presentation: Pick<PresentationApi, 'current' | 'present' | 'stop'>;
  views: Pick<ViewsApi, 'list' | 'subscribe'>;
  summaries: PresentedSceneSummaries;
}

/** The tab this view shows now, and the tab of this view that players see (null when they see another view's). */
export function presentingHere(env: { presentation: Pick<PresentationApi, 'current'>; views: Pick<ViewsApi, 'list'> }, viewId: string): { activeTabId: string | null; presentedHere: string | null } {
  const activeTabId = env.views.list().find((view) => view.viewId === viewId)?.activeTabId ?? null;
  const current = env.presentation.current();
  return { activeTabId, presentedHere: current?.viewId === viewId ? current.tabId : null };
}
