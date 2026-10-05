/**
 * "Controlled by" in a character token's context menu while an online session runs: every admitted player
 * as a checkbox that leaves the menu open (`keepOpen`, API 1.13.0), so several players can be ticked in a row, as in
 * the fork. Assignments live in the session's `TokenControl`, never in token data. Read through `onlineSessionStore`.
 * The menu is read again after every assignment and player change (`invalidate`): an open submenu follows its ticks.
 * An Atlas before 1.13.0 ignores `keepOpen` and closes the menu on each choice.
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
    keepOpen: true,
    onClick: () => control.set(tokenId, player.playerId, !control.controls(player.playerId, tokenId)),
  }));
}

/**
 * The token menu provider: the "Controlled by" submenu for a character token in a GM map view while a session is
 * hosted and can hand out tokens (no `TokenControl` means this Atlas cannot land players' moves); nothing otherwise,
 * also in a remote view (a player's, since 1.12.0).
 */
export function controlledByProvider(): (ctx: TokenMenuContext) => MenuItem[] {
  return (ctx) => {
    const { status, tokenControl, players } = onlineSessionStore.getState();
    if (ctx.isPlayerView || ctx.kind !== 'map' || ctx.tokenKind !== 'character' || status !== 'hosting' || !tokenControl) return [];
    return [{ label: CONTROLLED_BY_LABEL, icon: 'users', submenu: playerItems(tokenControl, players, ctx.tokenId) }];
  };
}
