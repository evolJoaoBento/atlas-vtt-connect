import type { PanelHandle, ToolbarItem, ViewContext } from '@atlas-vtt/api-types';
import type { OnlineSessionState } from '../onlineSessionStore';
import { ONLINE_SESSION_LABEL } from '../ui/onlineCopy';

/** Where the item sits among Atlas's own, which have 45 to 100. */
export const TOOLBAR_PRIORITY = 60;

export interface ToolbarEnv {
  panel: Pick<PanelHandle, 'toggle'>;
  /** The online session now (`onlineSessionStore.getState`). */
  session(): Pick<OnlineSessionState, 'status' | 'players'>;
  /** Tells that the view draws GM slots, so it can show the panel. */
  seen(ctx: ViewContext): void;
}

function waiting(session: Pick<OnlineSessionState, 'status' | 'players'>): number {
  return session.status === 'hosting' ? session.players.filter((player) => player.status === 'pending').length : 0;
}

/** The main toolbar's online session button: in use while hosting, with the number of players waiting to join on it. */
export function onlineToolbarItem(env: ToolbarEnv): ToolbarItem {
  return {
    id: 'online',
    icon: 'network',
    label: ONLINE_SESSION_LABEL,
    priority: TOOLBAR_PRIORITY,
    isActive: (ctx) => {
      env.seen(ctx);
      return env.session().status === 'hosting';
    },
    badge: (ctx) => {
      env.seen(ctx);
      const count = waiting(env.session());
      return count > 0 ? count : null;
    },
    onClick: (ctx) => env.panel.toggle(ctx.viewId),
  };
}
