/**
 * Atlas's motion curves for the player view's canvas animations, where Atlas uses framer-motion's: its ease-out
 * (`EASE_OUT_CONTROL_POINTS`, `cubic-bezier(0.23, 1, 0.32, 1)`) and framer's `easeInOut` (`cubic-bezier(0.42, 0, 0.58, 1)`).
 * Shared with the web page.
 */

/** A CSS `cubic-bezier(x1, y1, x2, y2)` timing function: progress (0 to 1) in, eased progress out. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (progress: number) => number {
  const curve = (a: number, b: number, t: number): number => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const slope = (a: number, b: number, t: number): number => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return (progress: number): number => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    // Newton's method for the curve's t at this x, then bisection should it stall.
    let t = progress;
    for (let i = 0; i < 8; i++) {
      const error = curve(x1, x2, t) - progress;
      if (Math.abs(error) < 1e-6) return curve(y1, y2, t);
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let low = 0;
    let high = 1;
    t = progress;
    for (let i = 0; i < 30; i++) {
      const x = curve(x1, x2, t);
      if (Math.abs(x - progress) < 1e-6) break;
      if (x < progress) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return curve(y1, y2, t);
  };
}

/** Atlas's ease-out (`EASE_OUT_CONTROL_POINTS`). */
export const easeOut = cubicBezier(0.23, 1, 0.32, 1);
/** framer-motion's `easeInOut`. */
export const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

/** Whether the viewer asked for less motion; false where nobody can say (tests, workers). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** One value easing from `from` to `to` over `duration` ms, starting `delay` ms after `start`. */
export interface Tween {
  from: number;
  to: number;
  start: number;
  delay: number;
  duration: number;
  ease: (progress: number) => number;
}

/** Where a tween is at `time`. */
export function tweenAt(tween: Tween, time: number): number {
  const progress = (time - tween.start - tween.delay) / tween.duration;
  if (progress <= 0) return tween.from;
  if (progress >= 1) return tween.to;
  return tween.from + (tween.to - tween.from) * tween.ease(progress);
}

/** Whether a tween has finished at `time`. */
export function tweenDone(tween: Tween, time: number): boolean {
  return time - tween.start - tween.delay >= tween.duration;
}
