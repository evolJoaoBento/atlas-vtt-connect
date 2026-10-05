import type { PanelHandle, ToolbarItem } from '@atlas-vtt/api-types';
import type { OnlineSessionState } from '../onlineSessionStore';
import { ONLINE_SESSION_LABEL } from '../ui/onlineCopy';

/**
 * Where the item sits among extensions' items, which sit together after Atlas's dice button (API 1.14.0): higher sits
 * further left. Atlas before 0.6 placed it among its own tools, which have 45 to 100.
 */
export const TOOLBAR_PRIORITY = 60;

export interface ToolbarEnv {
  panel: Pick<PanelHandle, 'toggle' | 'isOpen'>;
  /** The online session now (`onlineSessionStore.getState`). */
  session(): Pick<OnlineSessionState, 'status' | 'players'>;
}

function waiting(session: Pick<OnlineSessionState, 'status' | 'players'>): number {
  return session.status === 'hosting' ? session.players.filter((player) => player.status === 'pending').length : 0;
}

/**
 * The main toolbar's online session button. It is in use, and stays in the bar, while its panel is open in the view
 * or a session is hosted. It shows the number of players waiting to join, or a dot while hosting with nobody waiting.
 * Atlas reads it again when the panel opens or closes (`registerGmUi` invalidates on mount and unmount).
 */
export function onlineToolbarItem(env: ToolbarEnv): ToolbarItem {
  return {
    id: 'online',
    icon: 'network',
    label: ONLINE_SESSION_LABEL,
    priority: TOOLBAR_PRIORITY,
    isActive: (ctx) => env.panel.isOpen(ctx.viewId) || env.session().status === 'hosting',
    badge: () => {
      const session = env.session();
      const count = waiting(session);
      if (count > 0) return count;
      return session.status === 'hosting' ? true : null;
    },
    onClick: (ctx) => env.panel.toggle(ctx.viewId),
  };
}
