/**
 * The player's side of moving their own tokens: which tokens they control, the drag of
 * one, and what the view shows until the GM answers. While dragging, only this view
 * shows the token under the pointer (a preview); one `token-move` goes out on release.
 * The dropped token stays where it was dropped until the scene brings an update of it
 * (the GM's snapped position), a refusal arrives (it goes back, and "Move not allowed."
 * shows for `REFUSED_NOTICE_MS`) or `CONFIRM_TIMEOUT_MS` passes. A drag is cancelled,
 * sending nothing, by a new scene, the token leaving the scene, losing control of it or
 * the connection, and by `cancel` (Escape, pointer cancel, a second finger). Shared with
 * the web page.
 */
import { PAUSED_BANNER } from '../split/splitCopy';
import type { PlayerScene, PlayerToken, ScenePoint } from '../scene/sceneTypes';
import type { ScreenPoint } from './camera';
import type { TokenOverlay } from './layers/layerTypes';
import { controlledTokenAt } from './tokenHit';
import type { TokenGrab } from './ViewInput';

export const CONFIRM_TIMEOUT_MS = 2000;
export const REFUSED_NOTICE_MS = 3000;
export const MOVE_REFUSED_TEXT = 'Move not allowed.';

export interface TokenMovesOptions {
  /** A canvas point (CSS pixels from its top left) in world units, with the camera of now. */
  toWorld(point: ScreenPoint): ScenePoint;
  /** Sends one drop; false when it could not be sent. */
  send(tokenId: string, x: number, y: number): boolean;
  /** What the view shows changed: the overlay, the cursor or the notice. */
  onChange(): void;
}

interface Held {
  tokenId: string;
  /** Where the token was when it was grabbed: the drag ruler starts there. */
  origin: ScenePoint;
  /** From the pointer's world point to the token's centre, so the token does not jump to the pointer. */
  offset: ScenePoint;
  /** Where it is dragged to; null until the pointer moved past the slop. */
  position: ScenePoint | null;
}

interface Pending {
  position: ScenePoint;
  /** The token's record at the drop: a different record is the GM's answer. */
  token: PlayerToken;
  timer: number;
}

function tokenOf(scene: PlayerScene, tokenId: string): PlayerToken | null {
  return Object.hasOwn(scene.tokens, tokenId) ? scene.tokens[tokenId] ?? null : null;
}

export class TokenMoves implements TokenGrab {
  private scene: PlayerScene | null = null;
  private controlled: ReadonlySet<string> = new Set();
  private connected = false;
  private held: Held | null = null;
  private readonly pending = new Map<string, Pending>();
  private noticeText: string | null = null;
  /** The GM is on another scene: the paused banner shows, and refusals say nothing more. */
  private paused = false;
  private noticeTimer: number | null = null;

  constructor(private readonly options: TokenMovesOptions) {}

  /** A new scene (another `sceneId`) or none cancels the drag and drops every preview. */
  setScene(scene: PlayerScene | null): void {
    const previousId = this.scene?.sceneId ?? null;
    this.scene = scene;
    if (!scene || scene.sceneId !== previousId) {
      this.held = null;
      this.clearPending();
      this.options.onChange();
      return;
    }
    if (this.held && !tokenOf(scene, this.held.tokenId)) this.held = null;
    // Any update of a dropped token is the GM's answer: it now shows where the GM's scene put it.
    for (const [tokenId, entry] of this.pending) if (tokenOf(scene, tokenId) !== entry.token) this.settle(tokenId);
    this.options.onChange();
  }

  setControlled(tokenIds: readonly string[]): void {
    this.controlled = new Set(tokenIds);
    if (this.held && !this.controlled.has(this.held.tokenId)) this.held = null;
    this.options.onChange();
  }

  /** Only an admitted player drags: a lost connection cancels the drag. */
  setConnected(connected: boolean): void {
    if (connected === this.connected) return;
    this.connected = connected;
    if (!connected) this.held = null;
    this.options.onChange();
  }

  /** The scene is paused or live again (`scene-state`): while paused the notice is the paused banner. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.options.onChange();
  }

  /** The GM refused a move: the token shows its scene position, and the notice shows (not while paused: the banner says why). */
  refused(tokenId: string): void {
    this.settle(tokenId);
    if (this.paused) {
      this.options.onChange();
      return;
    }
    this.noticeText = MOVE_REFUSED_TEXT;
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null;
      this.noticeText = null;
      this.options.onChange();
    }, REFUSED_NOTICE_MS);
    this.options.onChange();
  }

  /** Whether a press at `point` would drag a token: the grab cursor. */
  canGrab(point: ScreenPoint): boolean {
    return this.tokenAt(point) !== null;
  }

  grab(point: ScreenPoint): boolean {
    const tokenId = this.tokenAt(point);
    const shown = tokenId === null ? null : this.shownPosition(tokenId);
    if (tokenId === null || !shown) return false;
    const world = this.options.toWorld(point);
    this.held = { tokenId, origin: { x: shown.x, y: shown.y }, offset: { x: shown.x - world.x, y: shown.y - world.y }, position: null };
    this.options.onChange();
    return true;
  }

  move(point: ScreenPoint): void {
    const held = this.held;
    if (!held) return;
    const world = this.options.toWorld(point);
    held.position = { x: world.x + held.offset.x, y: world.y + held.offset.y };
    this.options.onChange();
  }

  drop(point: ScreenPoint): void {
    const held = this.held;
    if (!held) return;
    this.move(point);
    this.held = null;
    const { tokenId, position } = held;
    const token = this.scene ? tokenOf(this.scene, tokenId) : null;
    if (token && position) {
      // Registered before sending: a refusal delivered synchronously must find it to settle.
      this.settle(tokenId);
      const timer = window.setTimeout(() => {
        this.settle(tokenId);
        this.options.onChange();
      }, CONFIRM_TIMEOUT_MS);
      this.pending.set(tokenId, { position, token, timer });
      if (!this.options.send(tokenId, position.x, position.y)) this.settle(tokenId);
    }
    this.options.onChange();
  }

  cancel(): void {
    if (!this.held) return;
    this.held = null;
    this.options.onChange();
  }

  isDragging(): boolean {
    return this.held !== null;
  }

  /** The token being dragged: where it was grabbed and where it is dragged to (null until it moved). */
  dragged(): { tokenId: string; origin: ScenePoint; position: ScenePoint | null } | null {
    const held = this.held;
    return held ? { tokenId: held.tokenId, origin: held.origin, position: held.position } : null;
  }

  notice(): string | null {
    return this.paused ? PAUSED_BANNER : this.noticeText;
  }

  overlay(): TokenOverlay {
    const positions = new Map<string, ScenePoint>();
    for (const [tokenId, entry] of this.pending) positions.set(tokenId, entry.position);
    if (this.held?.position) positions.set(this.held.tokenId, this.held.position);
    return { controlled: this.controlled, positions };
  }

  dispose(): void {
    this.held = null;
    this.clearPending();
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
  }

  private tokenAt(point: ScreenPoint): string | null {
    if (!this.connected || !this.scene) return null;
    return controlledTokenAt(this.scene, this.controlled, this.overlay().positions, this.options.toWorld(point));
  }

  private shownPosition(tokenId: string): ScenePoint | null {
    const pending = this.pending.get(tokenId);
    if (pending) return pending.position;
    const token = this.scene ? tokenOf(this.scene, tokenId) : null;
    return token ? { x: token.x, y: token.y } : null;
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
