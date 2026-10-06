/**
 * Applies the drops players send (`token-move`) to the sender's own scene. A move goes through only when the sender
 * controls the token, it is for the scene the sender has (`slotOf`), that scene is the one the GM's view shows now
 * (`shownSnapshot`: live, loaded, its tab's; a parked or loading scene's store holds another map, D5), the token is in
 * the sender's projection (not hidden, not under fog) and the coordinates are finite. The point is clamped to the
 * scene the sender sees, then Atlas's `tokens.move` on that scene's view snaps it as the GM's drag snaps, keeps it on
 * the map and writes it as one undo step. A move that fails a check, or that Atlas refuses, gets
 * `token-move-refused`; more than `MOVES_PER_SECOND` from one player in a second are ignored. A `GmSession` handler;
 * `GmSession` delivers only admitted players' messages.
 */
import type { TokensApi } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { sceneWorldBounds, type PreviewRect } from '../preview/previewLayout';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import type { ScenePoint } from '../scene/sceneTypes';
import type { SlotProjection } from '../scene/slotViews';
import type { TokenControl } from './TokenControl';

export const MOVES_PER_SECOND = 10;

type TokenMove = Extract<ControlMessage, { type: 'token-move' }>;

export interface TokenMoveHandlerOptions {
  session: SceneSession;
  /** The scene each player has, and the one the GM's view shows: moves are checked against both. */
  projection: Pick<SlotProjection, 'slotOf' | 'shownSnapshot'>;
  control: TokenControl;
  /** Atlas's token moves: the snapping, the map edge and the undo step are its. */
  tokens: Pick<TokensApi, 'move'>;
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
    if (this.apply(player.playerId, message)) return;
    // Only the id the player sent: a refusal says nothing about why, or about other tokens.
    this.options.session.send(player.playerId, { v: 1, type: 'token-move-refused', tokenId: message.tokenId });
  }

  /** Drops the windows of players who left the session: a reconnect must not reset one. */
  retainPlayers(known: ReadonlySet<string>): void {
    this.limit.retain(known);
  }

  /** Whether the move passed every check and Atlas wrote it. */
  private apply(playerId: string, move: TokenMove): boolean {
    const { control, projection, tokens } = this.options;
    if (!control.controls(playerId, move.tokenId)) return false;
    const slot = projection.slotOf(playerId);
    const scene = slot?.lastSent;
    if (!slot || !scene || scene.sceneId !== move.sceneId) return false;
    // Checked before the clamp: a clamp would turn an infinite coordinate into a point on the map's edge.
    if (!Number.isFinite(move.x) || !Number.isFinite(move.y)) return false;
    const { x, y } = clampTo({ x: move.x, y: move.y }, sceneWorldBounds(scene));
    // Read right before the move: the GM may have switched tabs since the player's scene was read (P2).
    const snapshot = projection.shownSnapshot(slot.sceneId);
    if (!snapshot || !Object.hasOwn(scene.tokens, move.tokenId) || !Object.hasOwn(snapshot.objects.tokens, move.tokenId)) return false;
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
