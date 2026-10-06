import type { PaletteCommand, PaletteSection, PanelHandle, PresentationApi, ViewsApi } from '@atlas-vtt/api-types';
import { onlineSessionStore } from '../onlineSessionStore';
import type { OnlineSessionService } from '../OnlineSessionService';
import { EVERYONE_BACK_COMMAND } from '../split/splitCopy';
import { canBringEveryoneBack } from '../splitStore';
import { ONLINE_SECTION_TITLE, ONLINE_SESSION_LABEL, PRESENT_LABEL, STOP_PRESENTING_LABEL, STOP_SESSION_LABEL } from '../ui/onlineCopy';
import { presentingActions } from './presentingHere';

export interface PaletteEnv {
  service: Pick<OnlineSessionService, 'stop' | 'everyoneBack'>;
  panel: Pick<PanelHandle, 'open'>;
  presentation: Pick<PresentationApi, 'current' | 'present' | 'stop'>;
  views: Pick<ViewsApi, 'list'>;
}

/** The palette's last section: the online play commands that apply now, in a GM map view (none in a remote view). */
export function onlinePaletteSection(env: PaletteEnv): PaletteSection {
  return {
    id: 'online',
    title: ONLINE_SECTION_TITLE,
    commands: (ctx): PaletteCommand[] => {
      if (ctx.kind !== 'map') return [];
      const { present, stop } = presentingActions(env, ctx);
      return [
        { id: 'online-session', icon: 'network', label: ONLINE_SESSION_LABEL, keywords: ['online', 'players', 'join', 'link', 'host'], run: () => env.panel.open(ctx.viewId) },
        ...(present ? [{ id: 'present-to-players', icon: 'cast', label: PRESENT_LABEL, keywords: ['online', 'show', 'scene'], run: () => { void env.presentation.present(ctx.viewId); } }] : []),
        ...(stop ? [{ id: 'stop-presenting', icon: 'square', label: STOP_PRESENTING_LABEL, keywords: ['online', 'hide', 'scene'], run: () => env.presentation.stop() }] : []),
        ...(canBringEveryoneBack(env.presentation)
          ? [{ id: 'everyone-back', icon: 'users', label: EVERYONE_BACK_COMMAND, keywords: ['online', 'players', 'scene', 'split'], run: () => env.service.everyoneBack() }]
          : []),
        ...(onlineSessionStore.getState().status === 'hosting'
          ? [{ id: 'stop-online-session', icon: 'power', label: STOP_SESSION_LABEL, keywords: ['online', 'end', 'host'], run: () => env.service.stop() }]
          : []),
      ];
    },
  };
}
