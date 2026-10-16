/**
 * Pings: "look here" on the map. A player taps the map with the Ping tool (`map-ping`); the GM relays it to the other
 * players of that scene and shows it on its own map. Each ping is a few rings that grow and fade at its point for
 * `PING_LIMITS.durationMs`, in its sender's colour. Shared by the GM, the join page and Obsidian.
 */
import type { ScenePoint } from '../scene/sceneTypes';

export const PING_LIMITS = {
  /** Pings a player may send per second; more are ignored. */
  perSecond: 2,
  /** How long a ping shows. */
  durationMs: 1600,
  /** Pings shown at once; older ones go first. */
  shown: 24,
  /** Rings per ping, one after another. */
  rings: 3,
} as const;

/** A ping as players and the GM receive it. */
export interface PlayerPing {
  from: string;
  sceneId: string;
  x: number;
  y: number;
  /** `#rrggbb`. */
  color: string;
}

/** One ring of a ping this frame: where, how far out (0 to 1) and how strong. */
export interface PingRing {
  x: number;
  y: number;
  color: string;
  /** How far the ring has grown, 0 at the point to 1 at its widest. */
  grown: number;
  alpha: number;
}

export function isPingPoint(value: { x?: unknown; y?: unknown }): value is ScenePoint {
  return typeof value.x === 'number' && Number.isFinite(value.x) && Math.abs(value.x) < 1e7
    && typeof value.y === 'number' && Number.isFinite(value.y) && Math.abs(value.y) < 1e7;
}

/** The pings showing now, as rings to draw. */
export class PingModel {
  private readonly pings: Array<{ x: number; y: number; color: string; at: number }> = [];

  add(point: ScenePoint, color: string, now: number): void {
    this.pings.push({ x: point.x, y: point.y, color, at: now });
    if (this.pings.length > PING_LIMITS.shown) this.pings.splice(0, this.pings.length - PING_LIMITS.shown);
  }

  /** The rings to draw at `now`; pings that are over are dropped. */
  frame(now: number): PingRing[] {
    const { durationMs, rings } = PING_LIMITS;
    for (let index = this.pings.length - 1; index >= 0; index--) {
      if (now - (this.pings[index]?.at ?? 0) >= durationMs) this.pings.splice(index, 1);
    }
    const shown: PingRing[] = [];
    for (const ping of this.pings) {
      const age = (now - ping.at) / durationMs;
      for (let ring = 0; ring < rings; ring++) {
        // Each ring starts a little after the one before and takes the rest of the time to grow.
        const start = ring * 0.18;
        const grown = (age - start) / (1 - start);
        if (grown < 0 || grown > 1) continue;
        shown.push({ x: ping.x, y: ping.y, color: ping.color, grown, alpha: (1 - grown) * 0.9 });
      }
    }
    return shown;
  }

  get active(): boolean {
    return this.pings.length > 0;
  }

  clear(): void {
    this.pings.length = 0;
  }
}

/** A ring's radius in screen pixels: from a dot to a circle a token or two across. */
export function ringRadius(grown: number): number {
  return 6 + grown * 46;
}
