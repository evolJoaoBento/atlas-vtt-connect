import type { PanelHandle, ToolbarItem, ViewContext } from '@atlas-vtt/api-types';
import type { OnlineSessionState } from '../onlineSessionStore';
import { ONLINE_SESSION_LABEL } from '../ui/onlineCopy';

/** Where the item sits among Atlas's own, which have 45 to 100. */
export const TOOLBAR_PRIORITY = 60;

export interface ToolbarEnv {
  panel: Pick<PanelHandle, 'toggle' | 'isOpen'>;
  /** The online session now (`onlineSessionStore.getState`). */
  session(): Pick<OnlineSessionState, 'status' | 'players'>;
  /** Tells that the view draws GM slots, so it can show the panel. */
  seen(ctx: ViewContext): void;
  /** Atlas reads the button's state again (the panel opened or closed). */
  invalidate(): void;
}

function waiting(session: Pick<OnlineSessionState, 'status' | 'players'>): number {
  return session.status === 'hosting' ? session.players.filter((player) => player.status === 'pending').length : 0;
}

/**
 * The main toolbar's online session button. It counts as in use while hosting, or while its panel is open here;
 * it shows the number of waiting players, or a dot while hosting with nobody waiting.
 */
export function onlineToolbarItem(env: ToolbarEnv): ToolbarItem {
  return {
    id: 'online',
    icon: 'network',
    label: ONLINE_SESSION_LABEL,
    priority: TOOLBAR_PRIORITY,
    isActive: (ctx) => {
      env.seen(ctx);
      return env.session().status === 'hosting' || env.panel.isOpen(ctx.viewId);
    },
    badge: (ctx) => {
      env.seen(ctx);
      const session = env.session();
      const count = waiting(session);
      if (count > 0) return count;
      return session.status === 'hosting' ? true : null;
    },
    onClick: (ctx) => {
      env.panel.toggle(ctx.viewId);
      env.invalidate();
    },
  };
}
