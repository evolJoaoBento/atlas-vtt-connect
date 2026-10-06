/**
 * The fog an Atlas remote view works out (`RemoteView.setScene`, API 1.16): Atlas covers the whole map for a scene
 * above any of these, so the GM does not send such fog (a clear and a notice instead) and the player's side refuses it.
 * Counted on what players receive: the projected fog and the darkness drawn with it. Imports only the wire types.
 */
import type { MapSize, PlayerFogOp } from './sceneTypes';

export const REMOTE_FOG_LIMITS = {
  /** Operations in all. */
  ops: 2000,
  /** Brush and lasso points in all. */
  points: 200_000,
  /** Points in one operation. */
  opPoints: 10_000,
  /** The brush limit while the map has no size, Atlas's largest map side. */
  unknownMapSide: 100_000,
} as const;

/** What the limits read of some fog: counts and the widest brush, never a point. */
export interface FogStats {
  ops: number;
  points: number;
  maxOpPoints: number;
  maxRadius: number;
}

export const NO_FOG_STATS: FogStats = { ops: 0, points: 0, maxOpPoints: 0, maxRadius: 0 };

export function fogStats(fog: Readonly<Record<string, PlayerFogOp>>): FogStats {
  const stats = { ...NO_FOG_STATS };
  for (const op of Object.values(fog)) {
    stats.ops++;
    if (op.type === 'rectangle') continue;
    const count = Array.isArray(op.points) ? op.points.length : 0;
    stats.points += count;
    stats.maxOpPoints = Math.max(stats.maxOpPoints, count);
    if (op.type === 'brush') stats.maxRadius = Math.max(stats.maxRadius, op.radius);
  }
  return stats;
}

export function addFogStats(a: FogStats, b: FogStats): FogStats {
  return { ops: a.ops + b.ops, points: a.points + b.points, maxOpPoints: Math.max(a.maxOpPoints, b.maxOpPoints), maxRadius: Math.max(a.maxRadius, b.maxRadius) };
}

/** Whether fog with these stats is more than a remote view works out on a map this size. */
export function fogOverRemoteLimits(stats: FogStats, map: MapSize): boolean {
  const side = Math.max(map.width, map.height);
  return stats.ops > REMOTE_FOG_LIMITS.ops || stats.points > REMOTE_FOG_LIMITS.points || stats.maxOpPoints > REMOTE_FOG_LIMITS.opPoints
    || stats.maxRadius > (side > 0 ? side : REMOTE_FOG_LIMITS.unknownMapSide);
}
