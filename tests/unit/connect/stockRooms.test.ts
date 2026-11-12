import { describe, expect, it } from 'vitest';
import { blockingWalls, withRoomWalls } from '../../../src/connect/stockRooms/stockRooms';

// A room's area as Atlas 0.14 keeps it: rings of eighth pixels.
const square = (x: number, y: number, size: number): number[][] => [[x, y, x + size, y, x + size, y + size, x, y + size].map((value) => value * 8)];
const room = (id: string, area: number[][], extra: Record<string, unknown> = {}) => ({ id, kind: 'room', name: id, order: 0, area, ...extra });

describe('Atlas 0.14 rooms as walls', () => {
  it('a map without rooms keeps its own walls record', () => {
    const walls = { w: { id: 'w', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } } };
    expect(blockingWalls(walls, undefined)).toBe(walls);
    expect(blockingWalls(walls, {})).toBe(walls);
    const objects = { tokens: {}, walls };
    expect(withRoomWalls(objects)).toBe(objects);
  });

  it('the outline of the shown rooms stands as solid walls beside the drawn ones, the same record while nothing changes', () => {
    const walls = { w: { id: 'w', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } } };
    const rooms = { a: room('a', square(0, 0, 100)), b: room('b', square(50, 0, 100), { order: 1 }), h: room('h', square(500, 500, 50), { order: 2, hidden: true }) };
    const merged = blockingWalls(walls, rooms) as Record<string, { type: string; p1: { x: number }; p2: { x: number } }>;
    expect(merged.w).toBe(walls.w);
    const outline = Object.values(merged).filter((wall) => wall.type === 'solid');
    // One outline round the two overlapping rooms (no wall between them), none for the hidden one.
    expect(outline).toHaveLength(4);
    expect(outline.every((wall) => [wall.p1.x, wall.p2.x].every((x) => x === 0 || x === 150))).toBe(true);
    expect(blockingWalls(walls, rooms)).toBe(merged);
    expect(withRoomWalls({ walls, rooms }).walls).toBe(merged);
  });
});
