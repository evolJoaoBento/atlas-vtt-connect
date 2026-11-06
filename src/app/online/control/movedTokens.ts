/**
 * Tokens the GM moves to another scene on Tabletop's board (`BoardSession.tokensMoved`): their players keep them (under
 * the new id, if the token got one), and each of those players is shown the scene the token went to, when the GM has
 * it open as a tab (a split party: `assign`). Without Atlas's scene tabs, or with the scene not open, they keep the
 * tokens and see what they saw.
 */
import type { TabScenes } from '../atlas/tabScenes';
import type { TabKey } from '../split/tabKey';
import type { TokensMoved } from '../tools/BoardSessionHub';
import type { TokenControl } from './TokenControl';

export interface MovedTokenDeps {
  control: Pick<TokenControl, 'playersOf' | 'move'> | null;
  tabs: Pick<TabScenes, 'tabs'> | null;
  assign(playerId: string, tab: TabKey): Promise<unknown>;
}

export function followMovedTokens(deps: MovedTokenDeps): (move: TokensMoved) => void {
  return (move) => {
    const players = new Set<string>();
    for (const { id, newId } of move.tokens) {
      for (const playerId of deps.control?.playersOf(id) ?? []) players.add(playerId);
      deps.control?.move(id, newId);
    }
    const tab = deps.tabs?.tabs().find((info) => info.mapPath === move.to) ?? null;
    if (!tab) return;
    for (const playerId of players) {
      deps.assign(playerId, { viewId: tab.viewId, tabId: tab.tabId }).catch((error: unknown) => console.error('[Atlas VTT Connect] Could not show the player the scene their token went to:', error));
    }
  };
}
