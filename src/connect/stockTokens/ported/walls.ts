/**
 * A store's `objects.walls` as a list of walls, read as Atlas reads them (`vision/wallList.ts` and `readWall` of
 * `lighting/lightingObjects.ts` in Atlas VTT 0.8.0; AGPL-3.0). Limited walls are switched off in Atlas (`LIMITED_WALLS` is
 * false), so a wall that says it is limited reads as one that blocks.
 */
import type { WallSegment } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const reads = new WeakMap<object, WallSegment | null>();

function wallOf(value: Record<string, unknown>): WallSegment | null {
  const isEnd = (end: unknown): boolean => isRecord(end) && finite(end.x) && finite(end.y);
  if (typeof value.id !== 'string' || !isEnd(value.p1) || !isEnd(value.p2)) return null;
  const { locked, blocks, limited, ...rest } = value;
  const flag = (it: unknown): boolean => it === undefined || it === true;
  if (flag(locked) && limited === undefined && (blocks === undefined || blocks === 'sight' || blocks === 'light')) return value as unknown as WallSegment;
  return { ...rest, ...(locked === true && { locked }), ...((blocks === 'sight' || blocks === 'light') && { blocks }) } as unknown as WallSegment;
}

export function readWall(value: unknown): WallSegment | null {
  if (!isRecord(value)) return null;
  if (!reads.has(value)) reads.set(value, wallOf(value));
  return reads.get(value) ?? null;
}

const lists = new WeakMap<object, readonly WallSegment[]>();

/** The walls of `objects.walls`, the same array for as long as the record is unchanged. */
export function wallList(walls: Record<string, unknown>): readonly WallSegment[] {
  let list = lists.get(walls);
  if (!list) {
    list = Object.values(walls).flatMap((wall) => readWall(wall) ?? []);
    lists.set(walls, list);
  }
  return list;
}
