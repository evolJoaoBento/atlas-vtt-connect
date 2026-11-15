/**
 * Where Atlas puts a scene's map image, for players. Atlas aligns a map to its grid by stretching it (`grid.mapStretch`:
 * x and y factors, and a slight turn), and a scene of several levels aligns each level's image on its own
 * (`levelAlignments`: stretch, a scale and an offset). The world players draw tokens, fog and grid in is the aligned
 * image's box, so a map that is only stretched fills the world rect and needs nothing more; a turned or shifted one sits
 * inside it, and players get its place as a matrix.
 *
 * Ported from Atlas VTT 0.10.2 (`Uf`, `Fan`, `CA`, `$4`, `oxe`, `xH`), © Fabian Urbanek, AGPL-3.0-only. Shared with the
 * web player page, so this file imports nothing.
 */

/** How the map image is aligned: factors by which it is stretched, a turn in degrees, and where it starts in the world. */
export interface MapAlignment {
  x: number;
  y: number;
  rotation?: number;
  offset?: { x: number; y: number };
}

/** The image's unit square (0..1 each way) mapped into the world, as a canvas matrix `[a, b, c, d, e, f]`: x' = a·u + c·v + e, y' = b·u + d·v + f. */
export type MapMatrix = readonly [number, number, number, number, number, number];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Atlas's limits on a stretch: each factor from 1 to 1.5, a turn of at most 5 degrees. */
const STRETCH_RANGE: readonly [number, number] = [1, 1.5];
const MAX_TURN = 5;
/** A level's scale and offset are held to what a map can be (`SCENE_RANGES.mapSize`), so no player gets a wild matrix. */
const MAX_SCALE = 20;
const MAX_OFFSET = 200_000;

/**
 * A stretch as Atlas reads it (`CA`): its factors and turn when they are in range and not the identity; null (no
 * stretch) for anything else, as Atlas draws such a map unstretched.
 */
export function readStretch(raw: unknown): MapAlignment | null {
  if (!isObject(raw)) return null;
  const { x, y, rotation } = raw;
  const factor = (value: unknown): value is number => isNumber(value) && value >= STRETCH_RANGE[0] && value <= STRETCH_RANGE[1];
  const turned = isNumber(rotation) && rotation !== 0 && Math.abs(rotation) <= MAX_TURN;
  if (!factor(x) || !factor(y)) return null;
  if (rotation !== undefined && !turned && rotation !== 0) return null;
  if (x === 1 && y === 1 && !turned) return null;
  return turned ? { x, y, rotation } : { x, y };
}

/**
 * The alignment of the map image of the level shown (`Uf`): that level's own alignment when the scene has one (its
 * stretch times its scale, its offset where one is above 0), else the grid's `mapStretch`. Null where the image is drawn
 * as it is, or where an alignment cannot be read: such a map is drawn unaligned rather than wrongly.
 */
export function effectiveAlignment(grid: object | null | undefined, levelAlignments: unknown, levelId: string | null): MapAlignment | null {
  const entry = levelId !== null && isObject(levelAlignments) ? levelAlignments[levelId] : undefined;
  if (!isObject(entry)) return readStretch((grid as { mapStretch?: unknown } | null | undefined)?.mapStretch);
  const stretch = readStretch(entry.stretch) ?? { x: 1, y: 1 };
  const { scale, offset } = entry;
  if (!isNumber(scale) || !(scale > 0) || scale > MAX_SCALE) return null;
  const x = stretch.x * scale;
  const y = stretch.y * scale;
  const shifted = isObject(offset) && isNumber(offset.x) && isNumber(offset.y) && Math.abs(offset.x) <= MAX_OFFSET && Math.abs(offset.y) <= MAX_OFFSET
    && (offset.x > 0 || offset.y > 0);
  return {
    x,
    y,
    ...(stretch.rotation ? { rotation: stretch.rotation } : {}),
    ...(shifted ? { offset: { x: (offset as { x: number }).x, y: (offset as { y: number }).y } } : {}),
  };
}

/**
 * An alignment a snapshot carries, checked field by field: null for anything that is not one Atlas could have made
 * (factors of at most the limits of a level's scale times a stretch, a turn of at most 5 degrees, a finite offset).
 */
export function readAlignment(raw: unknown): MapAlignment | null {
  if (!isObject(raw)) return null;
  const { x, y, rotation, offset } = raw;
  const limit = STRETCH_RANGE[1] * MAX_SCALE;
  if (!isNumber(x) || !isNumber(y) || !(x > 0) || !(y > 0) || x > limit || y > limit) return null;
  if (rotation !== undefined && (!isNumber(rotation) || Math.abs(rotation) > MAX_TURN)) return null;
  if (offset !== undefined && (!isObject(offset) || !isNumber(offset.x) || !isNumber(offset.y) || Math.abs(offset.x) > MAX_OFFSET || Math.abs(offset.y) > MAX_OFFSET)) return null;
  return {
    x,
    y,
    ...(rotation ? { rotation } : {}),
    ...(isObject(offset) ? { offset: { x: offset.x as number, y: offset.y as number } } : {}),
  };
}

/**
 * Where the image goes in the world, for a world rect of `world` size (what Atlas's map image reports as its size: the
 * turned image's box times the stretch, plus the offset). Null where the image just fills that rect (no turn, no
 * offset), which is how players draw every map without a matrix.
 */
export function mapMatrix(alignment: MapAlignment | null, world: { width: number; height: number }): MapMatrix | null {
  if (!alignment || (!alignment.rotation && !alignment.offset) || !(world.width > 0) || !(world.height > 0)) return null;
  const { x: sx, y: sy } = alignment;
  const ox = alignment.offset?.x ?? 0;
  const oy = alignment.offset?.y ?? 0;
  const turn = ((alignment.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  // The world rect is the turned image's box (`$4`) times the stretch, plus the offset: undo that for the box, then for
  // the image's own size (the box of a turned rectangle is linear in it, and well conditioned at a turn of 5 degrees).
  const boxWidth = (world.width - ox) / sx;
  const boxHeight = (world.height - oy) / sy;
  const det = cos * cos - sin * sin;
  const width = (boxWidth * Math.abs(cos) - boxHeight * Math.abs(sin)) / det;
  const height = (boxHeight * Math.abs(cos) - boxWidth * Math.abs(sin)) / det;
  if (!(width > 0) || !(height > 0)) return null;
  // `xH`: an image point (px, py) goes to ((boxWidth/2 + cos·(px - w/2) + sin·(py - h/2))·sx + ox, (boxHeight/2 - sin·(px - w/2) + cos·(py - h/2))·sy + oy).
  const matrix: MapMatrix = [
    sx * cos * width,
    -sy * sin * width,
    sx * sin * height,
    sy * cos * height,
    sx * (boxWidth / 2 - (cos * width) / 2 - (sin * height) / 2) + ox,
    sy * (boxHeight / 2 + (sin * width) / 2 - (cos * height) / 2) + oy,
  ];
  return matrix.every(Number.isFinite) ? matrix : null;
}
