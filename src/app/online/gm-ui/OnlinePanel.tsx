import React from 'react';
import { Copy, Square } from 'lucide-react';
import { Notice } from 'obsidian';
import type { ViewContext } from '@atlas-vtt/api-types';
import { Button } from '../../ui/primitives/Button';
import { LabelTooltip } from '../../ui/primitives/LabelTooltip';
import { TOKENS_UNAVAILABLE_NOTICE } from '../control/TokenControlHost';
import type { OnlineSessionService } from '../OnlineSessionService';
import type { OnlineSessionState } from '../onlineSessionStore';
import { JOIN_SESSION_LABEL, START_SESSION_LABEL, STOP_SESSION_LABEL } from '../ui/onlineCopy';
import { OnlinePlayerList } from './OnlinePlayerList';
import { OnlinePresenting } from './OnlinePresenting';
import type { PresentingEnv } from './presentingHere';
import { useOnlineSession } from './useOnlineState';

export const START_HELP = 'Start a session to get a link your players can open in a browser. You approve each player who joins.';

export type PanelService = Pick<OnlineSessionService, 'start' | 'stop' | 'allow' | 'deny' | 'kick' | 'link' | 'linkPlaceholder'>;

/** What the panel needs besides the view it is open in. */
export interface PanelEnv extends PresentingEnv {
  service: PanelService;
  /** Opens "Join online session…"; without it the panel offers no join. */
  joinSession?: () => void;
}

interface PanelProps { env: PanelEnv; ctx: ViewContext }

/**
 * The online session panel's content. Atlas draws the panel around it: its frame, its title and its close button.
 */
export function OnlinePanel({ env, ctx }: PanelProps): React.ReactElement {
  const session = useOnlineSession();
  return (
    <div className="atlas-connect-panel">
      {session.status === 'hosting' ? <HostingView session={session} env={env} ctx={ctx} /> : <StartView session={session} env={env} />}
    </div>
  );
}

function StartView({ session, env }: { session: OnlineSessionState; env: PanelEnv }): React.ReactElement {
  const starting = session.status === 'starting';
  return (
    <section className="atlas-connect-panel__section">
      <p className="atlas-connect-panel__help">{START_HELP}</p>
      {session.status === 'error' && session.error && (
        <p className="atlas-connect-panel__error" role="alert">{session.error}</p>
      )}
      <div className="atlas-connect-panel__footer">
        {env.joinSession && <Button disabled={starting} onClick={env.joinSession}>{JOIN_SESSION_LABEL}</Button>}
        <Button variant="cta" disabled={starting} onClick={() => { void env.service.start(); }}>
          {starting ? 'Starting…' : START_SESSION_LABEL}
        </Button>
      </div>
    </section>
  );
}

function HostingView({ session, env, ctx }: { session: OnlineSessionState; env: PanelEnv; ctx: ViewContext }): React.ReactElement {
  const url = session.joinUrl;
  return (
    <>
      <section className="atlas-connect-panel__section" aria-label="Session status">
        <p className="atlas-connect-panel__status">
          <span className="atlas-connect-panel__dot" aria-hidden="true" />
          <span className="atlas-connect-panel__status-text">Connected</span>
          <LabelTooltip label={STOP_SESSION_LABEL}>
            <Button variant="ghost" size="sm" aria-label={STOP_SESSION_LABEL} onClick={() => env.service.stop()}>
              <Square />
            </Button>
          </LabelTooltip>
        </p>
        {session.error && <p className="atlas-connect-panel__error" role="status">{session.error}</p>}
        {session.tokenControl === null && <p className="atlas-connect-panel__help" role="note">{TOKENS_UNAVAILABLE_NOTICE}</p>}
        {url && (
          <div className="atlas-connect-panel__link">
            <input type="text" readOnly value={url} aria-label="Join link" onFocus={(event) => event.currentTarget.select()} />
            <LabelTooltip label="Copy link">
              <Button variant="ghost" size="sm" aria-label="Copy link" onClick={() => copyJoinLink(url)}>
                <Copy />
              </Button>
            </LabelTooltip>
          </div>
        )}
      </section>
      <OnlinePlayerList players={session.players} requests={session.requests} control={session.tokenControl} service={env.service} summaries={env.summaries} />
      <OnlinePresenting env={env} ctx={ctx} />
    </>
  );
}

function copyJoinLink(url: string): void {
  void navigator.clipboard.writeText(url).then(
    () => new Notice('Join link copied'),
    () => new Notice('Could not copy the join link'),
  );
}
