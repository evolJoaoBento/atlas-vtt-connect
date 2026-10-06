import React from 'react';
import type { ViewContext } from '@atlas-vtt/api-types';
import { Button } from '../../ui/primitives/Button';
import { SPLIT_LIMITS } from '../split/splitLimits';
import { EVERYONE_BACK_LABEL, PRESENT_TO_NO_SCENE, UPDATE_ATLAS_NOTE, capPanelNote, splitStatus } from '../split/splitCopy';
import { PRESENT_LABEL, STOP_PRESENTING_LABEL } from '../ui/onlineCopy';
import { PresentToButton } from './PresentToButton';
import { presentToButtonLabel, presentToMenu, splitViewOf, type SplitActions, type SplitView } from './presentToRows';
import { presentingActions, presentingHere, tabNameIn, type PresentingEnv } from './presentingHere';
import { useActiveTabId, useOnlineSession, usePresentedSceneSummary, useViewTabsKey } from './useOnlineState';

/** The split party as the panel reads it: the store's players and assignments, Atlas's presented tab, the tab names. */
function useSplitView(env: PresentingEnv): SplitView {
  return splitViewOf(useOnlineSession(), env.presentation, (tab) => tabNameIn(env.views, tab));
}

interface OnlinePresentingProps {
  env: PresentingEnv;
  ctx: ViewContext;
  /** Assigning players to scenes (`OnlineSessionService`). */
  actions: SplitActions;
}

/** What players see, presenting this view's scene, stopping, and the split party: "Present to:" and "Everyone back". */
export function OnlinePresenting({ env, ctx, actions }: OnlinePresentingProps): React.ReactElement {
  const { tabId, name } = usePresentedSceneSummary(env.summaries);
  useActiveTabId(env.views, ctx.viewId); // renders again when the view moves to another tab
  useViewTabsKey(env.views, ctx.viewId); // and when a tab is renamed, added or closed
  const session = useOnlineSession();
  const view = useSplitView(env);
  const { present, stop } = presentingActions(env, ctx);
  const assigned = session.assignedCount;
  const status = tabId ? `Players see ${name ?? 'a scene'}.${assigned > 0 ? ` ${splitStatus(assigned)}` : ''}` : 'Players see no scene.';
  return (
    <section className="atlas-connect-panel__section" aria-label="Presented scene">
      <p className="atlas-connect-panel__help">{status}</p>
      {session.split === 'unsupported' && <p className="atlas-connect-panel__help">{UPDATE_ATLAS_NOTE}</p>}
      {session.split === 'on' && session.scenesInUse >= SPLIT_LIMITS.scenesInUse && <p className="atlas-connect-panel__help">{capPanelNote()}</p>}
      <div className="atlas-connect-panel__actions">
        {present && (
          <Button size="sm" onClick={() => { void env.presentation.present(ctx.viewId); }}>{PRESENT_LABEL}</Button>
        )}
        {stop && <Button size="sm" onClick={() => env.presentation.stop()}>{STOP_PRESENTING_LABEL}</Button>}
        {session.split === 'on' && assigned > 0 && (
          <Button size="sm" disabled={view.presented === null} onClick={() => actions.everyoneBack()}>{EVERYONE_BACK_LABEL}</Button>
        )}
      </div>
      {session.split === 'on' && <PresentToActiveTab env={env} ctx={ctx} view={view} actions={actions} />}
    </section>
  );
}

/** The "Present to:" button for the GM's active tab of this view (spec 3.2); disabled with no tab open. */
function PresentToActiveTab({ env, ctx, view, actions }: OnlinePresentingProps & { view: SplitView }): React.ReactElement {
  const { activeTabId } = presentingHere(env, ctx.viewId);
  if (activeTabId === null) return <PresentToButton label={PRESENT_TO_NO_SCENE} disabled menu={null} />;
  const tab = { viewId: ctx.viewId, tabId: activeTabId, name: tabNameIn(env.views, { viewId: ctx.viewId, tabId: activeTabId }) };
  return <PresentToButton label={presentToButtonLabel(view, tab)} disabled={false} menu={presentToMenu(tab, view, actions, 'panel')} />;
}
