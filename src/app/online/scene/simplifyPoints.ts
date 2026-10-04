import { SCENE_LIMITS, SCENE_RANGES } from './sceneLimits';
import type { ScenePoint } from './sceneTypes';

/** Fog and drawing points are simplified to this many world pixels. */
export const SIMPLIFY_TOLERANCE = 1;

export function distanceSqToSegment(point: ScenePoint, a: ScenePoint, b: ScenePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const ex = point.x - a.x - t * dx;
  const ey = point.y - a.y - t * dy;
  return ex * ex + ey * ey;
}

/**
 * Ramer–Douglas–Peucker: keeps the points that lie more than `tolerance` from
 * the line through the points kept around them. Iterative, so a long stroke
 * cannot overflow the stack.
 */
export function simplifyPoints(points: readonly ScenePoint[], tolerance: number): ScenePoint[] {
  const last = points.length - 1;
  if (last < 2) return points.map((point) => ({ x: point.x, y: point.y }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[last] = 1;
  const toleranceSq = tolerance * tolerance;
  const spans: Array<[number, number]> = [[0, last]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [start, end] = span;
    const a = points[start]!;
    const b = points[end]!;
    let farthest = -1;
    let farthestSq = toleranceSq;
    for (let index = start + 1; index < end; index++) {
      const distanceSq = distanceSqToSegment(points[index]!, a, b);
      if (distanceSq > farthestSq) {
        farthestSq = distanceSq;
        farthest = index;
      }
    }
    if (farthest === -1) continue;
    keep[farthest] = 1;
    spans.push([start, farthest], [farthest, end]);
  }
  return points.filter((_, index) => keep[index] === 1).map((point) => ({ x: point.x, y: point.y }));
}

/** The finite points of a GM point list of any shape, moved by the offset. */
export function finitePoints(points: unknown, offsetX = 0, offsetY = 0): ScenePoint[] {
  if (!Array.isArray(points)) return [];
  const result: ScenePoint[] = [];
  for (const point of points as unknown[]) {
    if (typeof point !== 'object' || point === null) continue;
    const { x, y } = point as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number') continue;
    const moved = { x: x + offsetX, y: y + offsetY };
    if (Number.isFinite(moved.x) && Number.isFinite(moved.y)) result.push(moved);
  }
  return result;
}

const [MIN_COORDINATE, MAX_COORDINATE] = SCENE_RANGES.coordinate;
const withinWorld = (value: number): number => Math.min(MAX_COORDINATE, Math.max(MIN_COORDINATE, value));
const roundToTenth = (value: number): number => Math.round(value * 10) / 10;

/**
 * Points ready to send: finite, moved by the offset, clamped to the wire's
 * coordinate range, simplified to 1 world pixel, rounded to 0.1 px and at
 * most `SCENE_LIMITS.points` of them (the tolerance doubles until they fit).
 */
export function wirePoints(points: unknown, offsetX = 0, offsetY = 0): ScenePoint[] {
  const finite = finitePoints(points, offsetX, offsetY).map((point) => ({ x: withinWorld(point.x), y: withinWorld(point.y) }));
  let tolerance = SIMPLIFY_TOLERANCE;
  let simplified = simplifyPoints(finite, tolerance);
  while (simplified.length > SCENE_LIMITS.points) {
    tolerance *= 2;
    simplified = simplifyPoints(finite, tolerance);
  }
  return simplified.map((point) => ({ x: roundToTenth(point.x), y: roundToTenth(point.y) }));
}
