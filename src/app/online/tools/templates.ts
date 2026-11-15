/**
 * Templates: an area a player leaves on the map (the Template tool: a line, a circle, a square or a cone), and every
 * other area of the scene as the 2D views draw it. They are Atlas's kept measures (`objects.measures`), which reach
 * players in the scene; `MapTemplate` is one of them as a view draws it (`sceneMeasures.ts`). A player asks to place
 * or remove one of their own with `map-template`. Each lies as Atlas shapes it (`shapedArea`): a circle around its
 * first point, a cone from it, a square from the middle of its near side, a line as wide as it says. Shared by the GM,
 * the join page and Obsidian.
 */
import { DEFAULT_CONE_END, shapedArea, type ShapedArea } from '../../../../packages/atlas-shared/src/index';
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
  /** The measure's id in Atlas (a kept ruler's legs: its id, a colon and the leg's number). */
  id: string;
  /** The player who made it (their session id); `gm` for the GM's and Atlas's own. */
  owner: string;
  shape: TemplateShape;
  start: ScenePoint;
  end: ScenePoint;
  /** `#rrggbb`: its own colour, else the accent. */
  color: string;
  /** A line's width, map pixels. */
  width?: number;
  /** A leg of a kept ruler: a thin line, no area. */
  ruler?: true;
  /** What the measure is: a player's template, a kept spell (the 3D board draws its shape itself), or an area made in Atlas. */
  kind?: 'template' | 'spell' | 'area';
  /** Atlas's look of the area. */
  effect?: string;
}

const isCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e7;
const isPoint = (value: unknown): value is ScenePoint => typeof value === 'object' && value !== null
  && isCoordinate((value as ScenePoint).x) && isCoordinate((value as ScenePoint).y);

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

/** The area of a template as Atlas shapes it; null for a ruler's leg, and for one without a size. */
function areaOf(template: Pick<MapTemplate, 'shape' | 'start' | 'end' | 'width' | 'ruler'>, coneAngleRadians: number): ShapedArea | null {
  if (template.ruler) return null;
  return shapedArea(
    { shape: template.shape, points: [template.start, template.end], ...(template.width !== undefined ? { width: template.width } : {}) },
    { coneAngle: (coneAngleRadians * 180) / Math.PI, coneEnd: DEFAULT_CONE_END, lineWidth: template.width ?? 0 },
  );
}

function toSegment(point: ScenePoint, a: ScenePoint, b: ScenePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const run = dx * dx + dy * dy;
  const along = run === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / run));
  return Math.hypot(point.x - (a.x + along * dx), point.y - (a.y + along * dy));
}

/** Whether a world point lies on a template: in its area, or within `slack` world units of its edge (of the line, for a ruler's leg). */
export function templateContains(template: MapTemplate, point: ScenePoint, coneAngleRadians: number, slack: number): boolean {
  const area = areaOf(template, coneAngleRadians);
  if (!area) return toSegment(point, template.start, template.end) <= slack;
  if (area.contains(point)) return true;
  if (!(slack > 0)) return false;
  if (template.shape === 'circle') return Math.hypot(point.x - template.start.x, point.y - template.start.y) <= area.reach + slack;
  // Atlas's own points are untyped in the shared copy.
  const rings = area.rings as ReadonlyArray<readonly ScenePoint[]>;
  return rings.some((ring) => ring.some((corner, index) => toSegment(point, corner, ring[(index + 1) % ring.length]!) <= slack));
}

/** The closed outline of a square, a cone or a line with a width; null for a circle (drawn as one) and a ruler's leg (a line). */
export function templateOutline(template: Pick<MapTemplate, 'shape' | 'start' | 'end' | 'width' | 'ruler'>, coneAngle: number): ScenePoint[] | null {
  if (template.shape === 'circle') return null;
  const ring = areaOf(template, coneAngle)?.rings[0] as readonly ScenePoint[] | undefined;
  return ring ? ring.map((corner) => ({ x: corner.x, y: corner.y })) : null;
}

/** The two points a template's size is measured between: a line's or cone's length, a circle's radius, a square's side. */
export function templateSpan(template: Pick<MapTemplate, 'shape' | 'start' | 'end'>): [ScenePoint, ScenePoint] {
  return [template.start, template.end];
}

/** Where a template's size label sits: a circle's middle, a square's or a line's midpoint, two thirds along a cone. */
export function templateLabelAt(template: Pick<MapTemplate, 'shape' | 'start' | 'end'>): ScenePoint {
  const { start, end } = template;
  if (template.shape === 'circle') return { x: start.x, y: start.y };
  const share = template.shape === 'cone' ? 2 / 3 : 1 / 2;
  return { x: start.x + (end.x - start.x) * share, y: start.y + (end.y - start.y) * share };
}
