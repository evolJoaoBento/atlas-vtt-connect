/**
 * Other people's lasers on a map, as data: which points of each are still showing and how faint. Stock Atlas has no
 * remote lasers, so the stand-in draws them itself (`laserOverlay.ts`) from this. The limits are the API's: a message
 * counts its newest 64 points, a gap in time at most 2 seconds, 32 lasers show at once, a laser not heard from for a
 * second is let go, and lasers are never saved.
 */
import type { RemoteLaser } from '@atlas-vtt/api-types';

export const LASER_LIMITS = {
  /** Points of one message that count: the newest. */
  points: 64,
  /** Lasers showing at once; others are ignored. */
  lasers: 32,
  /** The longest gap from one point to the one before it. */
  gapMs: 2000,
  /** A laser not heard from for this long is let go. */
  silenceMs: 1000,
  /** How long a point shows, fading out. */
  trailMs: 1500,
  /** Points kept of one laser. */
  kept: 256,
} as const;

interface Stamped {
  x: number;
  y: number;
  at: number;
}

interface State {
  color: string;
  points: Stamped[];
  lifted: boolean;
  heardAt: number;
}

/** A point of a laser as it is drawn: how opaque it is (1 is new). */
export interface ShownPoint {
  x: number;
  y: number;
  alpha: number;
}

export interface ShownLaser {
  from: string;
  color: string;
  points: ShownPoint[];
  /** The laser is still being drawn by its sender: its newest point glows. */
  live: boolean;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const HEX = /^#[0-9a-f]{6}$/i;

/** A laser the model can trust, or an error saying what is wrong (the call's contract). */
export function checkedLaser(laser: unknown): RemoteLaser {
  const given = (typeof laser === 'object' && laser !== null ? laser : {}) as Partial<Record<keyof RemoteLaser, unknown>>;
  const { from, color, lifted, points, dt } = given;
  if (typeof from !== 'string' || from === '') throw new Error('[Atlas VTT Connect] lasers.show: "from" must name whose laser it is.');
  if (typeof color !== 'string' || !HEX.test(color)) throw new Error('[Atlas VTT Connect] lasers.show: "color" must be a #rrggbb colour.');
  if (typeof lifted !== 'boolean') throw new Error('[Atlas VTT Connect] lasers.show: "lifted" must be true or false.');
  if (!Array.isArray(points)) throw new Error('[Atlas VTT Connect] lasers.show: "points" must be a list of { x, y } numbers.');
  // Only the newest points count, so the cost of a call does not grow with what is sent; `dt` keeps matching.
  const skip = Math.max(0, points.length - LASER_LIMITS.points);
  const taken = (points as unknown[]).slice(skip).map((point) => (typeof point === 'object' && point !== null ? { x: (point as { x: unknown }).x, y: (point as { y: unknown }).y } : null));
  if (!taken.every((point): point is { x: number; y: number } => point !== null && isNumber(point.x) && isNumber(point.y))) {
    throw new Error('[Atlas VTT Connect] lasers.show: "points" must be a list of { x, y } numbers.');
  }
  let gaps: number[] | undefined;
  if (dt !== undefined) {
    if (!Array.isArray(dt) || !(dt as unknown[]).every(isNumber)) throw new Error('[Atlas VTT Connect] lasers.show: "dt" must be a list of numbers.');
    const all = dt as number[];
    gaps = all.length === points.length ? all.slice(skip) : all.slice(-LASER_LIMITS.points);
  }
  return { from, color, lifted, points: taken, ...(gaps ? { dt: gaps } : {}) };
}

export class LaserModel {
  private readonly lasers = new Map<string, State>();

  /** Adds the newest points of a laser; `now` is when they arrived. Throws for a malformed laser. */
  show(laser: RemoteLaser, now: number): void {
    const checked = checkedLaser(laser);
    let state = this.lasers.get(checked.from);
    if (!state) {
      if (this.lasers.size >= LASER_LIMITS.lasers) return;
      state = { color: checked.color, points: [], lifted: false, heardAt: now };
      this.lasers.set(checked.from, state);
    }
    state.color = checked.color;
    state.lifted = checked.lifted;
    state.heardAt = now;
    // The points arrived together: the last one just now, each earlier one the gap before it earlier still.
    let at = now;
    const stamps: number[] = new Array<number>(checked.points.length);
    for (let index = checked.points.length - 1; index >= 0; index--) {
      stamps[index] = at;
      const gap = checked.dt?.[index];
      at -= isNumber(gap) ? Math.min(Math.max(gap, 0), LASER_LIMITS.gapMs) : 0;
    }
    checked.points.forEach((point, index) => state.points.push({ x: point.x, y: point.y, at: stamps[index]! }));
    if (state.points.length > LASER_LIMITS.kept) state.points.splice(0, state.points.length - LASER_LIMITS.kept);
  }

  /** What shows at `now`: points fade out over the trail and go; a laser with none left goes. */
  frame(now: number): ShownLaser[] {
    const shown: ShownLaser[] = [];
    for (const [from, state] of [...this.lasers]) {
      state.points = state.points.filter((point) => now - point.at < LASER_LIMITS.trailMs);
      if (state.points.length === 0 && (state.lifted || now - state.heardAt > LASER_LIMITS.silenceMs)) {
        this.lasers.delete(from);
        continue;
      }
      shown.push({
        from, color: state.color,
        points: state.points.map((point) => ({ x: point.x, y: point.y, alpha: 1 - (now - point.at) / LASER_LIMITS.trailMs })),
        live: !state.lifted && now - state.heardAt <= LASER_LIMITS.silenceMs,
      });
    }
    return shown;
  }

  /** Whether anything is left to draw or to fade. */
  get active(): boolean {
    return this.lasers.size > 0;
  }

  clear(): void {
    this.lasers.clear();
  }
}
