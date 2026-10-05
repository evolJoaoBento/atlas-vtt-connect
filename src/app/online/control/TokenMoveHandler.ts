/**
 * Applies the drops players send (`token-move`) to the presented scene. A move goes through only when
 * the sender controls the token, it is for the scene players have, that scene is live (not held, not
 * loading: a held view's store shows another map), the token is in the projection (not hidden, not under
 * fog) and the coordinates are finite. The point is clamped to the scene players see, then Atlas's
 * `tokens.move` snaps it as the GM's drag snaps, keeps it on the map and writes it as one undo step. A
 * move that fails a check, or that Atlas refuses, gets `token-move-refused`; more than `MOVES_PER_SECOND`
 * from one player in a second are ignored. A `GmSession` handler; `GmSession` delivers only admitted
 * players' messages.
 */
import type { TokensApi } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { sceneWorldBounds, type PreviewRect } from '../preview/previewLayout';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { CameraProjection } from '../scene/CameraSender';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import type { ScenePoint } from '../scene/sceneTypes';
import type { TokenControl } from './TokenControl';

export const MOVES_PER_SECOND = 10;

type TokenMove = Extract<ControlMessage, { type: 'token-move' }>;

export interface TokenMoveHandlerOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  /** The scene players have: moves are checked against it. */
  projection: Pick<CameraProjection, 'currentProjection'>;
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
    const { control, presented, projection, tokens } = this.options;
    if (!control.controls(playerId, move.tokenId)) return false;
    const scene = projection.currentProjection();
    const live = presented.current();
    if (!scene || scene.sceneId !== move.sceneId || !live || presented.isHeld()) return false;
    const snapshot = live.snapshot();
    if (!snapshot?.loaded || !Object.hasOwn(scene.tokens, move.tokenId) || !Object.hasOwn(snapshot.objects.tokens, move.tokenId)) return false;
    // Checked before the clamp: a clamp would turn an infinite coordinate into a point on the map's edge.
    if (!Number.isFinite(move.x) || !Number.isFinite(move.y)) return false;
    // Atlas refuses a hidden token itself (no `allowHidden`), also one hidden since the broadcaster's last tick.
    const { x, y } = clampTo({ x: move.x, y: move.y }, sceneWorldBounds(scene));
    return tokens.move(live.info.viewId, [{ tokenId: move.tokenId, x, y }], { snap: true, clampToMap: true }).ok;
  }
}

function clampTo(point: ScenePoint, bounds: PreviewRect | null): ScenePoint {
  if (!bounds) return point;
  return {
    x: Math.min(bounds.x + bounds.width, Math.max(bounds.x, point.x)),
    y: Math.min(bounds.y + bounds.height, Math.max(bounds.y, point.y)),
  };
}
