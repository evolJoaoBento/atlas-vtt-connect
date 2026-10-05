import React from 'react';
import type { ViewContext } from '@atlas-vtt/api-types';
import { Button } from '../../ui/primitives/Button';
import { PRESENT_LABEL, STOP_PRESENTING_LABEL } from '../ui/onlineCopy';
import { presentingActions, type PresentingEnv } from './presentingHere';
import { useActiveTabId, usePresentedSceneSummary } from './useOnlineState';

/** What players see, presenting this view's scene, and stopping. */
export function OnlinePresenting({ env, ctx }: { env: PresentingEnv; ctx: ViewContext }): React.ReactElement {
  const { tabId, name } = usePresentedSceneSummary(env.summaries);
  useActiveTabId(env.views, ctx.viewId); // renders again when the view moves to another tab
  const { present, stop } = presentingActions(env, ctx);
  return (
    <section className="atlas-connect-panel__section" aria-label="Presented scene">
      <p className="atlas-connect-panel__help">{tabId ? `Players see ${name ?? 'a scene'}.` : 'Players see no scene.'}</p>
      <div className="atlas-connect-panel__actions">
        {present && (
          <Button size="sm" onClick={() => { void env.presentation.present(ctx.viewId); }}>{PRESENT_LABEL}</Button>
        )}
        {stop && <Button size="sm" onClick={() => env.presentation.stop()}>{STOP_PRESENTING_LABEL}</Button>}
      </div>
    </section>
  );
}
