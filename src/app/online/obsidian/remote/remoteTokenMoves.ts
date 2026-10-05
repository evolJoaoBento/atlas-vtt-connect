/**
 * The player's side of moving their own tokens in a remote view, with Atlas's drag. Atlas reports a drop
 * at the snapped point (`onTokenDrop`); this sends one `token-move` and holds the token where it was
 * dropped until the GM answers: an update of that token, a refusal, or `CONFIRM_TIMEOUT_MS` passing. A
 * refusal ends any drag (`cancelDrag`) and shows "Move not allowed." for `REFUSED_NOTICE_MS`. The rules
 * are the web page's (`online/view/TokenMoves.ts`).
 */
import type { PlayerScene, PlayerToken, ScenePoint } from '../../scene/sceneTypes';
import { CONFIRM_TIMEOUT_MS, MOVE_REFUSED_TEXT, REFUSED_NOTICE_MS } from '../../view/TokenMoves';

interface Pending {
  position: ScenePoint;
  /** The token's record at the drop: a different record is the GM's answer. */
  token: PlayerToken | null;
  timer: number;
}

function tokenOf(scene: PlayerScene, tokenId: string): PlayerToken | null {
  return Object.hasOwn(scene.tokens, tokenId) ? scene.tokens[tokenId] ?? null : null;
}

export interface RemoteTokenMovesOptions {
  /** Whether the player may move `tokenId` now: in the session, and a token the GM gave them. */
  mayMove(tokenId: string): boolean;
  /** Sends one drop; false when it could not go. */
  send(tokenId: string, x: number, y: number): boolean;
  /** Ends a drag in progress (`RemoteView.cancelDrag`). */
  cancelDrag(): void;
  /** A position this view shows changed: feed the scene again. */
  onChange(): void;
  /** The refusal notice came or went. */
  onNotice(): void;
}

export class RemoteTokenMoves {
  private scene: PlayerScene | null = null;
  private readonly pending = new Map<string, Pending>();
  private noticeTimer: number | null = null;
  private shownNotice: string | null = null;

  constructor(private readonly options: RemoteTokenMovesOptions) {}

  /** The refusal notice now; null for none. */
  get notice(): string | null {
    return this.shownNotice;
  }

  /** Where the view holds `tokenId` instead of the GM's position; null for the GM's. */
  positionOf(tokenId: string): ScenePoint | null {
    return this.pending.get(tokenId)?.position ?? null;
  }

  /** Call before the scene is fed: an update of a dropped token is the GM's answer, a new scene drops every hold. */
  setScene(scene: PlayerScene | null): void {
    const previous = this.scene?.sceneId ?? null;
    this.scene = scene;
    if (!scene || scene.sceneId !== previous) {
      this.clearPending();
      return;
    }
    for (const [tokenId, entry] of [...this.pending]) if (tokenOf(scene, tokenId) !== entry.token) this.settle(tokenId);
  }

  /** Atlas dropped a token the player dragged: one `token-move`, and the token waits there for the GM. */
  drop(tokenId: string, x: number, y: number): void {
    const scene = this.scene;
    if (scene && tokenOf(scene, tokenId) !== null && this.options.mayMove(tokenId)) {
      this.settle(tokenId);
      // Registered before sending: a refusal delivered at once must find it to settle.
      const timer = window.setTimeout(() => {
        this.settle(tokenId);
        this.options.onChange();
      }, CONFIRM_TIMEOUT_MS);
      this.pending.set(tokenId, { position: { x, y }, token: tokenOf(scene, tokenId), timer });
      if (!this.options.send(tokenId, x, y)) this.settle(tokenId);
    }
    // A drop that did not go goes back to where the scene has the token.
    this.options.onChange();
  }

  /** The GM refused the move: the token goes back, and the notice shows for a while. */
  refused(tokenId: string): void {
    this.settle(tokenId);
    this.options.cancelDrag();
    this.setNotice(MOVE_REFUSED_TEXT);
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null;
      this.setNotice(null);
    }, REFUSED_NOTICE_MS);
    this.options.onChange();
  }

  dispose(): void {
    this.clearPending();
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
  }

  private setNotice(notice: string | null): void {
    this.shownNotice = notice;
    this.options.onNotice();
  }

  private settle(tokenId: string): void {
    const entry = this.pending.get(tokenId);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    this.pending.delete(tokenId);
  }

  private clearPending(): void {
    for (const tokenId of [...this.pending.keys()]) this.settle(tokenId);
  }
}
