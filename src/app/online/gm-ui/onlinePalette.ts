import type { PaletteCommand, PaletteSection, PanelHandle, PresentationApi, ViewContext, ViewsApi } from '@atlas-vtt/api-types';
import { onlineSessionStore } from '../onlineSessionStore';
import type { OnlineSessionService } from '../OnlineSessionService';
import { ONLINE_SECTION_TITLE, ONLINE_SESSION_LABEL, PRESENT_LABEL, STOP_PRESENTING_LABEL, STOP_SESSION_LABEL } from '../ui/onlineCopy';
import { presentingHere } from './presentingHere';

export interface PaletteEnv {
  service: Pick<OnlineSessionService, 'stop'>;
  panel: Pick<PanelHandle, 'open'>;
  presentation: Pick<PresentationApi, 'current' | 'present' | 'stop'>;
  views: Pick<ViewsApi, 'list'>;
  /** Tells that the view draws GM slots, so it can show the panel. */
  seen(ctx: ViewContext): void;
}

/** What the "Present to players" and "Stop presenting" entries of a view's menus offer now. */
export function presentingActions(env: { presentation: Pick<PresentationApi, 'current'>; views: Pick<ViewsApi, 'list'> }, ctx: ViewContext): { present: boolean; stop: boolean } {
  const { activeTabId, presentedHere } = presentingHere(env, ctx.viewId);
  return { present: activeTabId !== null && presentedHere !== activeTabId, stop: env.presentation.current() !== null };
}

/** The palette's last section: the online play commands that apply now. */
export function onlinePaletteSection(env: PaletteEnv): PaletteSection {
  return {
    id: 'online',
    title: ONLINE_SECTION_TITLE,
    commands: (ctx): PaletteCommand[] => {
      env.seen(ctx);
      const { present, stop } = presentingActions(env, ctx);
      return [
        { id: 'online-session', icon: 'network', label: ONLINE_SESSION_LABEL, keywords: ['online', 'players', 'join', 'link', 'host'], run: () => env.panel.open(ctx.viewId) },
        ...(present ? [{ id: 'present-to-players', icon: 'cast', label: PRESENT_LABEL, keywords: ['online', 'show', 'scene'], run: () => { void env.presentation.present(ctx.viewId); } }] : []),
        ...(stop ? [{ id: 'stop-presenting', icon: 'square', label: STOP_PRESENTING_LABEL, keywords: ['online', 'hide', 'scene'], run: () => env.presentation.stop() }] : []),
        ...(onlineSessionStore.getState().status === 'hosting'
          ? [{ id: 'stop-online-session', icon: 'power', label: STOP_SESSION_LABEL, keywords: ['online', 'end', 'host'], run: () => env.service.stop() }]
          : []),
      ];
    },
  };
}
