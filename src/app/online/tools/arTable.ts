/**
 * The AR table: where the printed marker sheets lie on the players' real table, shared by every phone.
 *
 * One phone surveys the table (its marker layout, learnt as it is swept over the sheets) and sends it to the GM
 * (`ar-survey`). The GM places it on the map on Tabletop's board, and every phone in AR on that map gets it placed (in
 * the board extras, `arTable`): a sheet in sight then puts the board where the GM put it, the same on every phone, with
 * nothing to learn first.
 *
 * A group is a sheet the markers are fixed on: the A4 sheet, a mat page or a card (their names as `markerGroup` gives
 * them). Its place is in millimetres, x right and y down, with its heading (radians, turning its x toward y), and its
 * outline (`w` × `h`, about its middle) for the GM to see.
 */

export interface ArTableGroup {
  group: string;
  x: number;
  y: number;
  heading: number;
  w: number;
  h: number;
}

/** A phone's survey: the groups in its own frame (the first sheet it saw is the origin), and its square size. */
export interface ArSurvey {
  squareMm: number;
  groups: ArTableGroup[];
}

/**
 * The table as the GM placed it, for the phones: the groups in the map's frame (millimetres from the map's top left,
 * x right and y down as the map reads), and how long a square of the map is on the table.
 */
export interface ArTable {
  squareMm: number;
  groups: ArTableGroup[];
}

export const AR_TABLE_LIMITS = {
  groups: 64,
  /** Millimetres a group may lie from the origin (ten metres). */
  reach: 10_000,
  /** Surveys a player may send in a minute. */
  surveysPerMinute: 6,
} as const;

/** The names `markerGroup` gives: the A4 sheet, a mat page, a card. */
export const GROUP_PATTERN = /^(sheet|mat-\d{1,2}|card-\d{1,3})$/;

const finite = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

export function isArTableGroup(value: unknown): value is ArTableGroup {
  if (typeof value !== 'object' || value === null) return false;
  const group = value as Partial<Record<keyof ArTableGroup, unknown>>;
  return typeof group.group === 'string' && GROUP_PATTERN.test(group.group)
    && finite(group.x, AR_TABLE_LIMITS.reach) && finite(group.y, AR_TABLE_LIMITS.reach) && finite(group.heading, 10)
    && finite(group.w, 1000) && group.w > 0 && finite(group.h, 1000) && group.h > 0;
}

/** A survey or a placed table as the wire must carry it: a square size and up to 64 groups, each named once. */
export function isArTable(value: unknown): value is ArTable {
  if (typeof value !== 'object' || value === null) return false;
  const table = value as Partial<Record<keyof ArTable, unknown>>;
  if (!finite(table.squareMm, 1000) || table.squareMm < 5) return false;
  if (!Array.isArray(table.groups) || table.groups.length === 0 || table.groups.length > AR_TABLE_LIMITS.groups) return false;
  if (!table.groups.every(isArTableGroup)) return false;
  return new Set(table.groups.map((group) => group.group)).size === table.groups.length;
}
