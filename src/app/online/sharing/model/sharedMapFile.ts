/**
 * A saved map as sharing reads it: what `scenes.readMap` hands out, in the shape of the fork's map file, so the
 * payload builders and the linked-notes list read one shape. Atlas 1.13.0 and later hand out the pins (with their
 * note links), walls, lights, light zones and camera; an older Atlas gives none of them, so its maps have none.
 */
import type { DrawingStroke, FogOperation, GridState, TextElement, TokenEntity } from '@atlas-vtt/api-types';
import { setOwn } from '../../scene/sceneDiff';

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
const isShortText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024;

/**
 * The note pins of a saved map that sharing can read, each rebuilt from the fields it knows. Atlas hands pins out as
 * saved, also ones it cannot read, so this fails closed: a pin without a pin id, finite x and y and a note path is
 * dropped, and a `gmOnly` that is set to anything but false counts as GM-only.
 */
export function readablePins(value: unknown): Record<string, NotePin> {
  const pins: Record<string, NotePin> = {};
  if (!isRecord(value)) return pins;
  for (const [key, pin] of Object.entries(value)) {
    if (!isRecord(pin) || pin.kind !== 'pin' || typeof pin.id !== 'string' || !Number.isFinite(pin.x) || !Number.isFinite(pin.y) || !isShortText(pin.notePath)) continue;
    setOwn(pins, key, {
      id: pin.id, kind: 'pin', x: pin.x as number, y: pin.y as number, notePath: pin.notePath,
      ...(typeof pin.icon === 'string' && pin.icon ? { icon: pin.icon } : {}), ...(typeof pin.label === 'string' && pin.label ? { label: pin.label } : {}),
      ...(pin.gmOnly !== undefined && pin.gmOnly !== false ? { gmOnly: true } : {}), ...(pin.hex === true ? { hex: true } : {}),
    });
  }
  return pins;
}

const isOptionalRecord = (value: unknown): boolean => value === undefined || isRecord(value);

/** The shape check Atlas makes of a map file's state (its `isLegacyMapFile`): a record whose objects, grid and camera are records when present. */
export function isMapFileBody(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const { objects, grid, camera } = value;
  if (!isOptionalRecord(objects) || !isOptionalRecord(camera) || !isOptionalRecord(grid)) return false;
  return !isRecord(objects) || isOptionalRecord(objects.tokens);
}
