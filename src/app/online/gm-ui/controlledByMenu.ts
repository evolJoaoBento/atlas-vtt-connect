/**
 * "Controlled by" in a character token's context menu while an online session runs: every admitted player
 * as a checkbox. Assignments live in the session's `TokenControl`, never in token data. Read through
 * `onlineSessionStore`. The menu is read again after every assignment and player change (`invalidate`).
 */
import type { MenuItem, TokenMenuContext } from '@atlas-vtt/api-types';
import type { TokenControl } from '../control/TokenControl';
import type { SessionPlayer } from '../GmSession';
import { onlineSessionStore } from '../onlineSessionStore';

export const CONTROLLED_BY_LABEL = 'Controlled by';
export const NO_PLAYERS_LABEL = 'No players connected';

function playerItems(control: TokenControl, players: readonly SessionPlayer[], tokenId: string): MenuItem[] {
  const admitted = players.filter((player) => player.status === 'admitted');
  if (admitted.length === 0) return [{ label: NO_PLAYERS_LABEL, disabled: true }];
  return admitted.map((player): MenuItem => ({
    label: player.name,
    checked: control.controls(player.playerId, tokenId),
    onClick: () => control.set(tokenId, player.playerId, !control.controls(player.playerId, tokenId)),
  }));
}

/**
 * The token menu provider: the "Controlled by" submenu for a character token in a GM view while a session is
 * hosted and can hand out tokens (no `TokenControl` means this Atlas cannot land players' moves); nothing otherwise.
 */
export function controlledByProvider(): (ctx: TokenMenuContext) => MenuItem[] {
  return (ctx) => {
    const { status, tokenControl, players } = onlineSessionStore.getState();
    if (ctx.isPlayerView || ctx.tokenKind !== 'character' || status !== 'hosting' || !tokenControl) return [];
    return [{ label: CONTROLLED_BY_LABEL, icon: 'users', submenu: playerItems(tokenControl, players, ctx.tokenId) }];
  };
}
