/**
 * Lasting spell templates: a line, a circle, a square or a cone a player leaves on the map (the Template tool), seen by
 * everyone on that scene, the GM included, until its owner taps it again or clears theirs, or the GM erases it. The GM keeps each scene's list
 * and sends all of it to the scene's players whenever it changes (`map-templates`); players ask to add or remove one
 * of their own (`map-template`). Shared by the GM, the join page and Obsidian.
 */
import type { ScenePoint } from '../scene/sceneTypes';

export const TEMPLATE_LIMITS = {
  /** Templates one player may have on a scene. */
  perPlayer: 10,
  /** Templates on one scene. */
  perScene: 40,
  /** Template changes a player may ask for per second. */
  perSecond: 4,
  idLength: 40,
} as const;

export const TEMPLATE_SHAPES = ['line', 'circle', 'square', 'cone'] as const;
export type TemplateShape = typeof TEMPLATE_SHAPES[number];

export interface MapTemplate {
  id: string;
  /** The player who placed it (their session id). */
  owner: string;
  shape: TemplateShape;
  start: ScenePoint;
  end: ScenePoint;
  /** `#rrggbb`: its owner's colour. */
  color: string;
}

const isCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e7;
const isPoint = (value: unknown): value is ScenePoint => typeof value === 'object' && value !== null
  && isCoordinate((value as ScenePoint).x) && isCoordinate((value as ScenePoint).y);
const HEX = /^#[0-9a-f]{6}$/i;

export function isTemplateShape(value: unknown): value is TemplateShape {
  return typeof value === 'string' && (TEMPLATE_SHAPES as readonly string[]).includes(value);
}

export function isTemplateId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= TEMPLATE_LIMITS.idLength && /^[\w-]+$/.test(value);
}

/** A template a player asks to place: shape and its two points. */
export function isTemplateDraft(value: { shape?: unknown; start?: unknown; end?: unknown }): value is { shape: TemplateShape; start: ScenePoint; end: ScenePoint } {
  return isTemplateShape(value.shape) && isPoint(value.start) && isPoint(value.end);
}

export function isMapTemplates(value: unknown): value is MapTemplate[] {
  return Array.isArray(value) && value.length <= TEMPLATE_LIMITS.perScene && value.every((template) => typeof template === 'object' && template !== null
    && isTemplateId((template as MapTemplate).id) && typeof (template as MapTemplate).owner === 'string' && (template as MapTemplate).owner.length <= 128
    && isTemplateDraft(template as MapTemplate) && typeof (template as MapTemplate).color === 'string' && HEX.test((template as MapTemplate).color));
}

/** Whether a world point lies on a template: within the circle or the cone, or near the line (`slack` world units). */
export function templateContains(template: MapTemplate, point: ScenePoint, coneAngleRadians: number, slack: number): boolean {
  const { start, end } = template;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const distance = Math.hypot(point.x - start.x, point.y - start.y);
  if (template.shape === 'circle') return distance <= length + slack;
  if (template.shape === 'square') {
    const corners = squareCorners(start, end);
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    return point.x >= Math.min(...xs) - slack && point.x <= Math.max(...xs) + slack && point.y >= Math.min(...ys) - slack && point.y <= Math.max(...ys) + slack;
  }
  if (template.shape === 'cone') {
    if (distance > length + slack) return false;
    if (distance <= slack) return true;
    const direction = Math.atan2(end.y - start.y, end.x - start.x);
    const angle = Math.atan2(point.y - start.y, point.x - start.x);
    const off = Math.abs(Math.atan2(Math.sin(angle - direction), Math.cos(angle - direction)));
    return off <= coneAngleRadians / 2 + slack / Math.max(distance, 1);
  }
  // A line: the distance to the segment.
  if (length === 0) return distance <= slack;
  const along = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)));
  return Math.hypot(point.x - (start.x + along * (end.x - start.x)), point.y - (start.y + along * (end.y - start.y))) <= slack;
}

/** A square's side: as long as the drag's longer reach, so it grows from `start` towards the pointer. */
export function squareSide(start: ScenePoint, end: ScenePoint): number {
  return Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
}

/** The corners of a square from `start` (one corner) towards `end`. */
export function squareCorners(start: ScenePoint, end: ScenePoint): ScenePoint[] {
  const side = squareSide(start, end);
  const x = start.x + (end.x < start.x ? -side : side);
  const y = start.y + (end.y < start.y ? -side : side);
  return [{ x: start.x, y: start.y }, { x, y: start.y }, { x, y }, { x: start.x, y }];
}

/** The closed outline of a square or a cone; null for a line or a circle, which are drawn from their two points. */
export function templateOutline(template: Pick<MapTemplate, 'shape' | 'start' | 'end'>, coneAngle: number): ScenePoint[] | null {
  if (template.shape === 'square') return squareCorners(template.start, template.end);
  if (template.shape === 'cone') return conePoints(template.start, template.end, coneAngle);
  return null;
}

/** The two points a template's size is measured between: a line's or cone's length, a circle's radius, a square's side. */
export function templateSpan(template: Pick<MapTemplate, 'shape' | 'start' | 'end'>): [ScenePoint, ScenePoint] {
  const { start, end } = template;
  if (template.shape === 'square') return [start, { x: start.x + squareSide(start, end), y: start.y }];
  return [start, end];
}

/** Where a template's size label sits: a circle's or square's middle, a line's midpoint, two thirds along a cone. */
export function templateLabelAt(template: Pick<MapTemplate, 'shape' | 'start' | 'end'>): ScenePoint {
  const { start, end } = template;
  if (template.shape === 'square') {
    const [, , far] = squareCorners(start, end);
    return { x: (start.x + far!.x) / 2, y: (start.y + far!.y) / 2 };
  }
  if (template.shape === 'circle') return { x: start.x, y: start.y };
  const share = template.shape === 'cone' ? 2 / 3 : 1 / 2;
  return { x: start.x + (end.x - start.x) * share, y: start.y + (end.y - start.y) * share };
}

/** Where the GM's erase button sits on a template, in world units: its far corner or end, on its edge. */
export function templateHandleAt(template: Pick<MapTemplate, 'shape' | 'start' | 'end'>): ScenePoint {
  const { start, end } = template;
  if (template.shape === 'circle') {
    const radius = Math.hypot(end.x - start.x, end.y - start.y);
    return { x: start.x + radius * Math.SQRT1_2, y: start.y - radius * Math.SQRT1_2 };
  }
  if (template.shape === 'square') {
    const corners = squareCorners(start, end);
    return { x: Math.max(...corners.map((c) => c.x)), y: Math.min(...corners.map((c) => c.y)) };
  }
  return { x: end.x, y: end.y };
}

/** The outline of a cone from `start` towards `end`, opening by `angle` radians: its apex and arc. */
export function conePoints(start: ScenePoint, end: ScenePoint, angle: number, segments = 24): ScenePoint[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const direction = Math.atan2(end.y - start.y, end.x - start.x);
  const points: ScenePoint[] = [{ x: start.x, y: start.y }];
  for (let index = 0; index <= segments; index++) {
    const at = direction - angle / 2 + (angle * index) / segments;
    points.push({ x: start.x + Math.cos(at) * length, y: start.y + Math.sin(at) * length });
  }
  return points;
}
