/**
 * Tokens glide to a new position instead of jumping, with Atlas's own motion (`SyncService.animateTokenToPosition`):
 * a steady 400 world px a second, never shorter than 150 ms nor longer than 600 ms, eased in and out (quad). So a
 * dropped token slides into the cell the GM's grid snapped it to, a refused move slides back, and a token the GM
 * moved slides over. A token the player is dragging follows the pointer; a new token, or any on a new scene, is
 * simply there. Shared with the web page.
 */
import type { ScenePoint } from '../../scene/sceneTypes';

/** Atlas's numbers (`SyncService`): pixels per second, and the shortest and longest glide. */
export const TOKEN_GLIDE = { pixelsPerSecond: 400, minMs: 150, maxMs: 600 } as const;
/** Closer than this in both axes is the same place (Atlas's 0.1). */
const SAME_PLACE = 0.1;

interface Glide {
  from: ScenePoint;
  to: ScenePoint;
  start: number;
  duration: number;
}

/** How long Atlas takes to move a token this far. */
export function glideDuration(distance: number): number {
  return Math.max(TOKEN_GLIDE.minMs, Math.min(TOKEN_GLIDE.maxMs, (distance / TOKEN_GLIDE.pixelsPerSecond) * 1000));
}

/** Atlas's easeInOutQuad. */
export function easeInOutQuad(progress: number): number {
  return progress < 0.5 ? 2 * progress * progress : 1 - 2 * (1 - progress) * (1 - progress);
}

const samePlace = (a: ScenePoint, b: ScenePoint): boolean => Math.abs(a.x - b.x) < SAME_PLACE && Math.abs(a.y - b.y) < SAME_PLACE;

export class TokenGlides {
  /** Where each token was last drawn. */
  private readonly shown = new Map<string, ScenePoint>();
  private readonly glides = new Map<string, Glide>();
  private sceneId: string | null = null;
  /** Tokens seen during the frame being drawn: the others left the scene. */
  private readonly seen = new Set<string>();

  constructor(private readonly now: () => number) {}

  /** Starts a frame; a new scene forgets every token, so nothing glides in from the scene before. */
  begin(sceneId: string): void {
    if (sceneId !== this.sceneId) {
      this.sceneId = sceneId;
      this.shown.clear();
      this.glides.clear();
    }
    this.seen.clear();
  }

  /** Where to draw the token this frame, heading for `target`; a `held` one (being dragged) is at its target. */
  position(id: string, target: ScenePoint, held: boolean): ScenePoint {
    this.seen.add(id);
    const last = this.shown.get(id);
    let glide = this.glides.get(id);
    if (held || !last) {
      this.glides.delete(id);
      this.shown.set(id, target);
      return target;
    }
    const time = this.now();
    if (glide ? !samePlace(glide.to, target) : !samePlace(last, target)) {
      // A new target, also mid-glide: from where it is drawn now, as Atlas starts from its sprite's place.
      const from = glide ? this.at(glide, time) : last;
      glide = { from, to: target, start: time, duration: glideDuration(Math.hypot(target.x - from.x, target.y - from.y)) };
      this.glides.set(id, glide);
    }
    const point = glide ? this.at(glide, time) : target;
    if (glide && time - glide.start >= glide.duration) this.glides.delete(id);
    this.shown.set(id, point);
    return point;
  }

  /** Ends a frame: tokens that were not drawn left the scene, and one coming back is simply there. */
  end(): void {
    for (const id of [...this.shown.keys()]) {
      if (this.seen.has(id)) continue;
      this.shown.delete(id);
      this.glides.delete(id);
    }
  }

  /** Whether a token is still on its way: the view keeps drawing. */
  animating(): boolean {
    return this.glides.size > 0;
  }

  private at(glide: Glide, time: number): ScenePoint {
    const progress = Math.min(1, Math.max(0, (time - glide.start) / glide.duration));
    if (progress >= 1) return glide.to;
    const eased = easeInOutQuad(progress);
    return { x: glide.from.x + (glide.to.x - glide.from.x) * eased, y: glide.from.y + (glide.to.y - glide.from.y) * eased };
  }
}
