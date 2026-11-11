// Atlas source: src/app/types/shapeTypes.ts @ 0.14.0 (AGPL-3.0), copied for Connect's reading of rooms (rooms.ts).
/** Integer world coordinates in eighths of a pixel. */
export type Q = number;

/** A ring as [x0, y0, x1, y1, …], without a repeated closing point. */
export type QPolygon = readonly Q[];

/** NonZero boundary rings: positive outer contours and negative holes. */
export type QShape = readonly QPolygon[];

export const Q_SCALE = 8;
export const MAX_Q = 2 ** 24;
