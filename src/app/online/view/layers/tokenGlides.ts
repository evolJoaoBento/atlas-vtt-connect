/**
 * Tokens glide to a new position instead of jumping, with Atlas's own motion (`TokenGlide.glideStep`): every frame a
 * token covers the same share of the way that is left, about two thirds of it in 50 ms, so it snaps quickly into the
 * cell the GM's grid put it in, and a new place given mid-way bends the path instead of restarting it. A token the
 * player is dragging follows the pointer; a new token, or any on a new scene, is simply there. On a lit scene only the
 * player's own tokens glide, as only the party's do in Atlas (`TokenRenderer.mayGlide`): any other is put in its place
 * at once, as a glide would show players where it came from. Nothing glides when the viewer asks for less motion.
 * Shared with the web page.
 */
import type { ScenePoint } from '../../scene/sceneTypes';

/** Atlas's numbers (`TokenGlide`): about a third of the way is left after `ms`; closer than `arrived` px, it is there. */
export const TOKEN_GLIDE = { ms: 50, arrived: 0.05 } as const;
/** The longest frame a glide steps by: a tab that was hidden for a while does not jump a token there in one step. */
const LONGEST_STEP_MS = 100;

/** Where a glide from `from` towards `to` is `elapsedMs` later; `to` itself once it has arrived (Atlas's `glideStep`). */
export function glideStep(from: ScenePoint, to: ScenePoint, elapsedMs: number): ScenePoint {
  const left = Math.exp(-elapsedMs / TOKEN_GLIDE.ms);
  const dx = (to.x - from.x) * left;
  const dy = (to.y - from.y) * left;
  if (Math.abs(dx) < TOKEN_GLIDE.arrived && Math.abs(dy) < TOKEN_GLIDE.arrived) return to;
  return { x: to.x - dx, y: to.y - dy };
}

export class TokenGlides {
  /** Where each token was last drawn. */
  private readonly shown = new Map<string, ScenePoint>();
  /** Tokens still on their way. */
  private readonly moving = new Set<string>();
  private sceneId: string | null = null;
  /** Tokens seen during the frame being drawn: the others left the scene. */
  private readonly seen = new Set<string>();
  private lastFrame: number | null = null;
  private elapsed = 0;

  constructor(private readonly now: () => number, private readonly reducedMotion: () => boolean = () => false) {}

  /** Starts a frame; a new scene forgets every token, so nothing glides in from the scene before. */
  begin(sceneId: string): void {
    if (sceneId !== this.sceneId) {
      this.sceneId = sceneId;
      this.shown.clear();
      this.moving.clear();
    }
    const time = this.now();
    this.elapsed = this.lastFrame === null ? 0 : Math.min(LONGEST_STEP_MS, Math.max(0, time - this.lastFrame));
    this.lastFrame = time;
    this.seen.clear();
  }

  /**
   * Where to draw the token this frame, heading for `target`. A `held` one (being dragged) is at its target, and so is
   * one that may not be shown on its way (`mayGlide` false: another's token on a lit scene).
   */
  position(id: string, target: ScenePoint, held: boolean, mayGlide = true): ScenePoint {
    this.seen.add(id);
    const last = this.shown.get(id);
    if (held || !last || !mayGlide || this.reducedMotion()) {
      this.moving.delete(id);
      this.shown.set(id, target);
      return target;
    }
    if (last.x === target.x && last.y === target.y) {
      this.moving.delete(id);
      return target;
    }
    const point = glideStep(last, target, this.elapsed);
    if (point === target) this.moving.delete(id);
    else this.moving.add(id);
    this.shown.set(id, point);
    return point;
  }

  /** Ends a frame: tokens that were not drawn left the scene, and one coming back is simply there. */
  end(): void {
    for (const id of [...this.shown.keys()]) {
      if (this.seen.has(id)) continue;
      this.shown.delete(id);
      this.moving.delete(id);
    }
    // A frame with nothing moving starts the next glide from its own time, not from this one.
    if (this.moving.size === 0) this.lastFrame = null;
  }

  /** Whether a token is still on its way: the view keeps drawing. */
  animating(): boolean {
    return this.moving.size > 0;
  }
}
