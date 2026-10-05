/**
 * Fog operations, texts and drawings as players receive them. Every object is
 * built field by field from the GM record, never spread, so a field this file
 * does not name never leaves the GM's machine.
 */
import type { DrawingStroke, FogOperation, TextElement } from '@atlas-vtt/api-types';
import { finiteOr, finiteOrNull, oneOf, positiveOr, positiveOrNull, textOr, textOrNull, unitOr } from './coerce';
import type { Shows } from './FogCoverage';
import { DEFAULT_FONT_SIZE, drawingBounds, textBounds } from './objectBounds';
import {
  PLAYER_DRAWING_TYPES, PLAYER_TEXT_ALIGNS, type PlayerDrawing, type PlayerFogOp, type PlayerText,
} from './sceneTypes';
import { SCENE_LIMITS, SCENE_RANGES } from './sceneLimits';
import { isSceneId } from './sceneValidation';
import { wirePoints } from './simplifyPoints';

/**
 * Projections by GM record. Immer keeps unchanged records, so their projections
 * are reused and their points are not simplified again on every change.
 */
export interface ProjectionMemo {
  fog: WeakMap<FogOperation, PlayerFogOp | null>;
  drawings: WeakMap<DrawingStroke, PlayerDrawing | null>;
}

export function createProjectionMemo(): ProjectionMemo {
  return { fog: new WeakMap(), drawings: new WeakMap() };
}

function memoized<K extends object, V>(memo: WeakMap<K, V>, key: K, project: (key: K) => V): V {
  if (memo.has(key)) return memo.get(key) as V;
  const value = project(key);
  memo.set(key, value);
  return value;
}

/** Up to `SCENE_LIMITS.records` records with safe ids, each projected; `null` drops a record. */
export function projectRecord<G, P>(records: Readonly<Record<string, G>> | undefined, project: (record: G, id: string) => P | null): Record<string, P> {
  const result: Record<string, P> = {};
  let count = 0;
  for (const [id, record] of Object.entries(records ?? {})) {
    if (count >= SCENE_LIMITS.records) break;
    if (!isSceneId(id) || typeof record !== 'object' || record === null) continue;
    const projected = project(record, id);
    if (projected === null) continue;
    result[id] = projected;
    count++;
  }
  return result;
}

/**
 * A rectangle's extent on one axis as `[start, length]` inside the validator's ranges. The
 * edges are clamped, not the length, so the area only loses what lies beyond the coordinate
 * range; a span longer than the range keeps its start. NaN when a value is missing.
 */
function clampedSpan(start: unknown, length: unknown, offset: number): [number, number] {
  const from = finiteOrNull(start);
  const size = finiteOrNull(length);
  if (from === null || size === null) return [Number.NaN, Number.NaN];
  const a = from + offset;
  const b = a + size;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [Number.NaN, Number.NaN];
  const max = SCENE_RANGES.coordinate[1];
  const left = finiteOr(Math.min(a, b), 0, SCENE_RANGES.coordinate);
  const right = finiteOr(Math.max(a, b), 0, SCENE_RANGES.coordinate);
  return [left, Math.min(right - left, max)];
}

/** A fog operation with its drag offset applied; null when it has nothing to draw. */
export function projectFogOp(op: FogOperation): PlayerFogOp | null {
  const dx = finiteOr(op.offsetX, 0);
  const dy = finiteOr(op.offsetY, 0);
  // Truthy erases, as on the GM canvas and in `FogCoverage`.
  const erase = Boolean(op.isErasing);
  const order = finiteOr(op.timestamp, 0);
  switch (op.type) {
    case 'rectangle': {
      const [left, width] = clampedSpan(op.x, op.width, dx);
      const [top, height] = clampedSpan(op.y, op.height, dy);
      return Number.isNaN(left + width + top + height) ? null : { type: 'rectangle', erase, order, x: left, y: top, width, height };
    }
    case 'brush': {
      const points = wirePoints(op.points, dx, dy);
      return points.length > 0 ? { type: 'brush', erase, order, radius: positiveOr(op.brushRadius, 1, SCENE_RANGES.stroke), points } : null;
    }
    case 'lasso': {
      const points = wirePoints(op.points, dx, dy);
      return points.length >= 3 ? { type: 'lasso', erase, order, points } : null;
    }
    default:
      return null;
  }
}

export function projectFog(fog: Readonly<Record<string, FogOperation>> | undefined, memo: ProjectionMemo): Record<string, PlayerFogOp> {
  return projectRecord(fog, (op) => memoized(memo.fog, op, projectFogOp));
}

/**
 * Whether the fog players would get covers less than the GM's: more operations than `SCENE_LIMITS.records`
 * (`extra` counts the darkness drawn with them), or one that covers but is not sent as it is: its id is refused,
 * it projects to nothing (an unknown type, points that do not read), or its brush is wider than the wire allows.
 * What such fog hides cannot be proven hidden, so live play sends a clear and a player-safe share is refused.
 */
export function fogTruncated(fog: Readonly<Record<string, FogOperation>> | undefined, memo: ProjectionMemo, extra = 0): boolean {
  const entries = Object.entries(fog ?? {});
  if (entries.length + extra > SCENE_LIMITS.records) return true;
  return entries.some(([id, op]) => {
    if (typeof op !== 'object' || op === null || Boolean(op.isErasing)) return false;
    if (!isSceneId(id) || memoized(memo.fog, op, projectFogOp) === null) return true;
    return op.type === 'brush' && finiteOr(op.brushRadius, 0) > SCENE_RANGES.stroke[1];
  });
}

/**
 * A text players may see: only when `visible` shows every part of it, as the GM draws it and as players would
 * (the wire's clamped size can be larger); null otherwise or without a position.
 */
export function projectText(text: TextElement, visible: Shows): PlayerText | null {
  const x = finiteOrNull(text.x, SCENE_RANGES.coordinate);
  const y = finiteOrNull(text.y, SCENE_RANGES.coordinate);
  if (x === null || y === null || !visible.shows(textBounds(text))) return null;
  const sent = textOnWire(text, x, y);
  return visible.shows(textBounds(sent as unknown as TextElement)) ? sent : null;
}

function textOnWire(text: TextElement, x: number, y: number): PlayerText {
  return {
    x,
    y,
    text: textOr(text.text, '', SCENE_LIMITS.textLength),
    fontSize: positiveOr(text.fontSize, DEFAULT_FONT_SIZE, SCENE_RANGES.fontSize),
    fontFamily: textOr(text.fontFamily, 'sans-serif'),
    color: textOr(text.color, '#000000'),
    backgroundColor: textOrNull(text.backgroundColor),
    padding: Math.max(0, finiteOr(text.padding, 0, SCENE_RANGES.stroke)),
    borderRadius: Math.max(0, finiteOr(text.borderRadius, 0, SCENE_RANGES.stroke)),
    opacity: unitOr(text.opacity, 1),
    width: positiveOrNull(text.width, SCENE_RANGES.textBox),
    height: positiveOrNull(text.height, SCENE_RANGES.textBox),
    align: oneOf(PLAYER_TEXT_ALIGNS, text.align, 'center'),
    bold: text.bold === true,
    italic: text.italic === true,
    rotation: finiteOr(text.rotation, 0),
    scale: positiveOr(text.scale, 1, SCENE_RANGES.textScale),
  };
}

export function projectTexts(texts: Readonly<Record<string, TextElement>> | undefined, visible: Shows): Record<string, PlayerText> {
  return projectRecord(texts, (text) => projectText(text, visible));
}

/** A drawing's shape with its points simplified; null without points. Fog is checked by the caller. */
export function projectDrawingShape(stroke: DrawingStroke): PlayerDrawing | null {
  const points = wirePoints(stroke.points);
  if (points.length === 0) return null;
  const type = oneOf(PLAYER_DRAWING_TYPES, stroke.type, 'pen');
  return {
    type,
    order: finiteOr(stroke.timestamp, 0),
    points,
    color: textOr(stroke.color, '#000000'),
    width: positiveOr(stroke.width, 1, SCENE_RANGES.stroke),
    opacity: unitOr(stroke.opacity, 1),
    icon: type === 'icon' ? textOrNull(stroke.icon) : null,
  };
}

export function projectDrawings(
  drawings: Readonly<Record<string, DrawingStroke>> | undefined,
  visible: Shows,
  memo: ProjectionMemo,
): Record<string, PlayerDrawing> {
  // The drawing as players draw it (its simplified points, its clamped width) must be shown whole.
  return projectRecord(drawings, (stroke) => {
    const drawing = memoized(memo.drawings, stroke, projectDrawingShape);
    return drawing && visible.shows(drawingBounds(drawing)) ? drawing : null;
  });
}
