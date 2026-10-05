/**
 * A saved map as sharing reads it: what `scenes.readMap` hands out, in the shape of the fork's map file, so the
 * payload builders and the linked-notes list read one shape. `readMap` gives no pins, walls, lights or camera
 * (they stay Atlas's), so a map read from Atlas has none; the builders still handle them when present.
 */
import type { DrawingStroke, FogOperation, GridState, TextElement, TokenEntity } from '@atlas-vtt/api-types';

/** A note pin, as Atlas saves it. */
export interface NotePin {
  id: string;
  kind: 'pin';
  x: number;
  y: number;
  notePath: string;
  icon?: string;
  label?: string;
  gmOnly?: boolean;
  /** Links the note to the grid cell containing (x, y) instead of marking a point. */
  hex?: boolean;
}

export interface SharedMapFile {
  background: string | null;
  grid: GridState | null;
  objects: {
    tokens: Record<string, TokenEntity>;
    fog: Record<string, FogOperation>;
    texts: Record<string, TextElement>;
    drawings: Record<string, DrawingStroke>;
    pins: Record<string, NotePin>;
    /** Anything else a full share carries as it is (walls, lights), its paths cleared. */
    [other: string]: unknown;
  };
  camera?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isOptionalRecord = (value: unknown): boolean => value === undefined || isRecord(value);

/** The shape check Atlas makes of a map file's state (its `isLegacyMapFile`): a record whose objects, grid and camera are records when present. */
export function isMapFileBody(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const { objects, grid, camera } = value;
  if (!isOptionalRecord(objects) || !isOptionalRecord(camera) || !isOptionalRecord(grid)) return false;
  return !isRecord(objects) || isOptionalRecord(objects.tokens);
}
