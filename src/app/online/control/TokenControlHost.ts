/**
 * Everything one online session needs to let players move their own tokens: the
 * assignments (`TokenControl`), each player's list (`ControlLists`, per scene while split), the moves
 * (`TokenMoveHandler`, through Atlas's `tokens.move`, on the sender's scene) and dropping tokens deleted from the
 * scene the GM's view shows. Started after the scene hub and the camera sender, so its messages follow theirs.
 */
import type { TokensApi } from '@atlas-vtt/api-types';
import type { SessionPlayer } from '../GmSession';
import type { SceneSession } from '../scene/sceneSources';
import type { SlotProjection } from '../scene/slotViews';
import { ControlLists } from './ControlLists';
import { watchDeletedTokens } from './deletedTokens';
import { TokenControl } from './TokenControl';
import { TokenMoveHandler } from './TokenMoveHandler';

export interface TokenControlHostOptions {
  session: SceneSession;
  /** The scene each player has (the scene hub): lists and moves are worked out against it. */
  projection: SlotProjection;
  tokens: Pick<TokensApi, 'move'>;
}

/** What the GM reads when this Atlas cannot land players' moves (no `tokens` capability): nobody can drag. */
export const TOKENS_UNAVAILABLE_NOTICE = 'Update Atlas VTT to let players move tokens.';

export class TokenControlHost {
  readonly control = new TokenControl();
  private readonly lists: ControlLists;
  private readonly moves: TokenMoveHandler;
  private stopWatching: (() => void) | null = null;

  constructor(private readonly options: TokenControlHostOptions) {
    this.lists = new ControlLists({ session: options.session, control: this.control, projection: options.projection });
    this.moves = new TokenMoveHandler({ ...options, control: this.control });
  }

  start(): void {
    if (this.stopWatching) return;
    this.lists.start();
    this.moves.start();
    this.stopWatching = watchDeletedTokens(this.options.projection, this.control);
  }

  stop(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    this.lists.stop();
    this.moves.stop();
  }

  /** The session's players changed: a removed (kicked) player loses their tokens; one who is only gone keeps them. */
  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.control.retainPlayers(known);
    this.moves.retainPlayers(known);
  }
}
