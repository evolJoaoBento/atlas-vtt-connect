/**
 * Atlas 0.14's rooms (`objects.rooms`): on a level with rooms everything outside them is rock, and the outline of its
 * shown rooms stands as solid walls (Atlas's `blockingWalls`). Connect reads walls for what players get (Tabletop's
 * 3D board) and for where a player's token stops, so it reads them with the rooms' outline, as Atlas does. A map
 * without rooms (any Atlas before 0.14) keeps its own walls record, untouched.
 */
import { readRooms, roomWalls } from './ported/rooms';

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/** By walls record, then rooms record: the same merged record while neither changes, so what compares by reference holds. */
const merged = new WeakMap<object, WeakMap<object, Raw>>();
const NO_WALLS: Raw = Object.freeze({});

/** A level's walls with its rooms' outline (`objects` already cut to the level); `walls` itself where there are no rooms. */
export function blockingWalls(walls: unknown, rooms: unknown): unknown {
  if (!isObj(rooms)) return walls;
  const list = readRooms(rooms);
  if (list.length === 0) return walls;
  const own = isObj(walls) ? walls : NO_WALLS;
  let byRooms = merged.get(own);
  if (!byRooms) merged.set(own, byRooms = new WeakMap());
  let record = byRooms.get(rooms);
  if (!record) byRooms.set(rooms, record = { ...own, ...Object.fromEntries(roomWalls(list).map((wall) => [wall.id, wall])) });
  return record;
}

/** `objects` with its walls standing with its rooms' outline (`blockingWalls`); `objects` itself where there are no rooms. */
export function withRoomWalls<T extends object>(objects: T): T {
  const { walls, rooms } = objects as { walls?: unknown; rooms?: unknown };
  const blocking = blockingWalls(walls, rooms);
  return blocking === walls ? objects : { ...objects, walls: blocking };
}
