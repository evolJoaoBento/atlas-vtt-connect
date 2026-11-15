/**
 * Players in augmented reality, for the GM's board: a player's phone tells where its camera is over the map they have
 * (`ar-view`: its pose in board units, down its −z, up its +y; null when the tracking is lost or AR ends), and the GM's
 * Tabletop board shows it as an eye in the player's colour (`ArViewRelay`). Nothing goes to the other players.
 */

/** A phone camera's pose in board units: where it is, and which way it faces. */
export interface ArPose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

export const AR_VIEW_LIMITS = {
  /** The page sends at most ten a second; the GM takes a few more for jitter. */
  perSecond: 15,
  /** Board units from the map's origin a camera may be. */
  maxCoordinate: 1e7,
} as const;

const isFinite = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/** A pose as the wire must carry it: three numbers in range and a unit quaternion. */
export function isArPose(value: unknown): value is ArPose {
  if (typeof value !== 'object' || value === null) return false;
  const { position, quaternion } = value as Partial<Record<keyof ArPose, unknown>>;
  if (!Array.isArray(position) || position.length !== 3 || !position.every((v) => isFinite(v, AR_VIEW_LIMITS.maxCoordinate))) return false;
  if (!Array.isArray(quaternion) || quaternion.length !== 4 || !quaternion.every((v) => isFinite(v, 1.01))) return false;
  const length = Math.hypot(...quaternion);
  return length > 0.9 && length < 1.1;
}
