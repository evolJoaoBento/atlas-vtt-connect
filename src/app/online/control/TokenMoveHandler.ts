/**
 * Applies the drops players send (`token-move`) to the sender's own scene. A move goes through only when the sender
 * controls the token, it is for the scene the sender has (`slotOf`), that scene is the one the GM's view shows now
 * (`shownSnapshot`: live, loaded, its tab's; a parked or loading scene's store holds another map, D5), the token is in
 * the sender's projection (not hidden, not under fog) and the coordinates are finite. The point is clamped to the
 * scene the sender sees, then Atlas's `tokens.move` on that scene's view snaps it as the GM's drag snaps, keeps it on
 * the map and writes it as one undo step. A move that fails a check, or that Atlas refuses, gets
 * `token-move-refused`, with the reason `not-held` when all that stood in its way is that the GM's Atlas holds another
 * map just now (Atlas holds one map at a time, and nothing is ever written to a map it does not hold); more than `MOVES_PER_SECOND` from one player in a second are ignored. A `GmSession` handler;
 * `GmSession` delivers only admitted players' messages.
 */
import type { TokensApi } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { sceneWorldBounds, type PreviewRect } from '../preview/previewLayout';
import type { ControlMessage, MoveRefusedReason } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import type { ScenePoint } from '../scene/sceneTypes';
import type { SlotProjection } from '../scene/slotViews';
import type { TokenControl } from './TokenControl';
import { heldOffTurn } from './turnHold';

export const MOVES_PER_SECOND = 10;

type TokenMove = Extract<ControlMessage, { type: 'token-move' }>;

export interface TokenMoveHandlerOptions {
  session: SceneSession;
  /** The scene each player has, and the one the GM's view shows: moves are checked against both. */
  projection: Pick<SlotProjection, 'slotOf' | 'shownSnapshot'>;
  control: TokenControl;
  /** Atlas's token moves: the snapping, the map edge and the undo step are its. */
  tokens: Pick<TokensApi, 'move'>;
  /** Whether the GM lets players move only on their turn (Atlas's "Players move only on their turn"); asked at each move. Without it they may move at any time. */
  movesOnTurn?: () => boolean;
  /** While a cutscene runs, players' tokens do not move; without it they move as ever. */
  cutscene?: { running(): boolean };
}

/** At most `MOVES_PER_SECOND` moves per player in any one-second window; refused ones count. */
export class MoveRateLimit extends RateLimit {
  constructor() {
    super(MOVES_PER_SECOND);
  }
}

export class TokenMoveHandler implements SessionHandler {
  private readonly limit = new MoveRateLimit();
  private stopSession: (() => void) | null = null;

  constructor(private readonly options: TokenMoveHandlerOptions) {}

  start(): void {
    if (!this.stopSession) this.stopSession = this.options.session.use(this);
  }

  stop(): void {
    this.stopSession?.();
    this.stopSession = null;
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'token-move' || !this.limit.allow(player.playerId, Date.now())) return;
    const result = this.apply(player.playerId, message);
    if (result === true) return;
    // Only the id the player sent: a refusal says nothing about other tokens, and why only where the player can wait it out.
    this.options.session.send(player.playerId, { v: 1, type: 'token-move-refused', tokenId: message.tokenId, ...(result === false ? {} : { reason: result }) });
  }

  /** Drops the windows of players who left the session: a reconnect must not reset one. */
  retainPlayers(known: ReadonlySet<string>): void {
    this.limit.retain(known);
  }

  /** Whether the move passed every check and Atlas wrote it: true, false, or why not where the player is told. */
  private apply(playerId: string, move: TokenMove): boolean | MoveRefusedReason {
    const { control, projection, tokens } = this.options;
    // The players' tokens stand still for the length of a cutscene.
    if (this.options.cutscene?.running()) return false;
    if (!control.controls(playerId, move.tokenId)) return false;
    const slot = projection.slotOf(playerId);
    const scene = slot?.lastSent;
    if (!slot || !scene || scene.sceneId !== move.sceneId) return false;
    // During a fight the token must have the turn, where the GM asks for that: judged on what the player was sent.
    if (this.options.movesOnTurn?.() === true && heldOffTurn(scene, move.tokenId)) return false;
    // Checked before the clamp: a clamp would turn an infinite coordinate into a point on the map's edge.
    if (!Number.isFinite(move.x) || !Number.isFinite(move.y)) return false;
    const { x, y } = clampTo({ x: move.x, y: move.y }, sceneWorldBounds(scene));
    // Read right before the move: the GM may have switched tabs since the player's scene was read (P2).
    const snapshot = projection.shownSnapshot(slot.sceneId);
    // The player's own token on the scene they have, and Atlas shows another map or is still loading this one.
    if (!snapshot) return Object.hasOwn(scene.tokens, move.tokenId) ? 'not-held' : false;
    if (!Object.hasOwn(scene.tokens, move.tokenId) || !Object.hasOwn(snapshot.objects.tokens, move.tokenId)) return false;
    // Atlas refuses a hidden token itself (no `allowHidden`), also one hidden since the hub's last tick.
    return tokens.move(slot.tab.viewId, [{ tokenId: move.tokenId, x, y }], { snap: true, clampToMap: true }).ok;
  }
}

function clampTo(point: ScenePoint, bounds: PreviewRect | null): ScenePoint {
  if (!bounds) return point;
  return {
    x: Math.min(bounds.x + bounds.width, Math.max(bounds.x, point.x)),
    y: Math.min(bounds.y + bounds.height, Math.max(bounds.y, point.y)),
  };
}
