/**
 * Resource bars ease to each new value as Atlas's do (`AnimatedBarFill`): the fill moves over 400 ms on Atlas's
 * ease-out; a loss leaves a pale trail of the lost amount that drains after a beat (350 ms, then 500 ms eased in and
 * out), and a gain shows the new amount as that trail at once while the fill grows into it. A bar's first value, any
 * bar on a new scene, and every change when the viewer asks for less motion show at once. Shared with the web page.
 */
import { easeInOut, easeOut, tweenAt, tweenDone, type Tween } from '../motion';

/** Atlas's numbers (`AnimatedBarFill`), in ms. */
export const BAR_MOTION = { fillMs: 400, trailDelayMs: 350, trailMs: 500, trailAlpha: 0.55, trailLighten: 0.55 } as const;

/** What a bar shows this frame: its fill and the pale trail behind it, as fractions of the bar. */
export interface BarFrame {
  fill: number;
  trail: number;
}

interface BarState {
  target: number;
  fill: number;
  trail: number;
  fillTween: Tween | null;
  trailTween: Tween | null;
}

const clamp = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

export class BarFills {
  private readonly bars = new Map<string, BarState>();
  private readonly seen = new Set<string>();
  private sceneId: string | null = null;

  constructor(private readonly now: () => number, private readonly reducedMotion: () => boolean = () => false) {}

  /** Starts a frame; a new scene forgets every bar, so none animates from the scene before. */
  begin(sceneId: string): void {
    if (sceneId !== this.sceneId) {
      this.sceneId = sceneId;
      this.bars.clear();
    }
    this.seen.clear();
  }

  /** What the bar `key` (a token and its slot) shows this frame, heading for `share`. */
  frame(key: string, share: number): BarFrame {
    this.seen.add(key);
    const target = clamp(share);
    const time = this.now();
    let bar = this.bars.get(key);
    if (!bar || this.reducedMotion()) {
      bar = { target, fill: target, trail: target, fillTween: null, trailTween: null };
      this.bars.set(key, bar);
      return { fill: target, trail: target };
    }
    if (target !== bar.target) {
      const fill = bar.fillTween ? tweenAt(bar.fillTween, time) : bar.fill;
      const trail = bar.trailTween ? tweenAt(bar.trailTween, time) : bar.trail;
      bar.target = target;
      bar.fillTween = { from: fill, to: target, start: time, delay: 0, duration: BAR_MOTION.fillMs, ease: easeOut };
      if (target >= trail) {
        bar.trail = target;
        bar.trailTween = null;
      } else {
        bar.trailTween = { from: trail, to: target, start: time, delay: BAR_MOTION.trailDelayMs, duration: BAR_MOTION.trailMs, ease: easeInOut };
      }
    }
    if (bar.fillTween) {
      bar.fill = tweenAt(bar.fillTween, time);
      if (tweenDone(bar.fillTween, time)) bar.fillTween = null;
    }
    if (bar.trailTween) {
      bar.trail = tweenAt(bar.trailTween, time);
      if (tweenDone(bar.trailTween, time)) bar.trailTween = null;
    }
    return { fill: bar.fill, trail: bar.trail };
  }

  /** Ends a frame: bars not drawn went (their token left, was hidden or lost the resource), and come back without easing. */
  end(): void {
    for (const key of [...this.bars.keys()]) if (!this.seen.has(key)) this.bars.delete(key);
  }

  /** Whether a bar is still moving: the view keeps drawing. */
  animating(): boolean {
    for (const bar of this.bars.values()) if (bar.fillTween || bar.trailTween) return true;
    return false;
  }
}
