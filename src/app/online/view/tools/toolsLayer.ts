/**
 * What the player's tools draw over the scene, above the fog as Atlas draws its measurements and
 * lasers: the measurement, the drag ruler, then everyone's lasers. Lines, points and labels
 * follow Atlas's measure drawing (`measureGeometry.ts`). Lasers follow its Canvas-renderer beam
 * (`CanvasLaserBeam`): the body in the person's colour and a white-hot filament, without the
 * glow, at the default size. Shared with the web page.
 */
import {
  beamRadius, beamSmoothingSpacing, beamWidth, FILAMENT_COLOR, FILAMENT_SHARE, smoothBeam, type BeamPoint,
} from '@atlas-vtt/shared/draw';
import {
  arcPoints, coneGeometry, MEASURE_AREA, MEASURE_LABEL_COLORS, MEASURE_PATH_STROKES, MEASURE_POINT, MEASURE_SHADOW,
  measureLabelAnchor, measureLabelBox, measureLabelFontSize, pathMidpoint,
} from '@atlas-vtt/shared/draw';
import { DEFAULT_LASER_POINTER_SETTINGS } from '@atlas-vtt/shared/rules';
import type { ScenePoint } from '../../scene/sceneTypes';
import type { OverlayLayer } from '../layers/layerTypes';
import { cssColor } from '../layers/tokenUiDrawing';
import type { ViewSurface } from '../ViewSurface';
import type { MeasureOverlay } from './MeasureTool';
import type { PlayerTools, ToolOverlay } from './PlayerTools';

/** The join page's accent (`--accent` in `style.css`), standing in for the GM's Obsidian accent. */
export const MEASURE_ACCENT = '#7c5cff';
const LABEL_FONT_FAMILY = 'sans-serif';
/** A label's height per unit of font size, about one line as PIXI measures it. */
const LABEL_LINE_HEIGHT = 1.2;
/** A cone's arc gets a segment per 8 screen pixels, from 8 to 64 of them. */
const ARC_PIXELS_PER_SEGMENT = 8;
const MIN_ARC_SEGMENTS = 8;
const MAX_ARC_SEGMENTS = 64;
const SHADOW = cssColor(MEASURE_SHADOW);
const FILAMENT = cssColor(FILAMENT_COLOR);
const LABEL_TEXT = '#ffffff';

export function createToolsLayer(tools: Pick<PlayerTools, 'overlay' | 'isAnimating'>): OverlayLayer {
  return {
    draw: (surface, frame) => drawTools(surface, tools.overlay(), frame.zoom),
    animating: () => tools.isAnimating(),
  };
}

/** `zoom`: screen pixels per world unit, as Atlas's viewport scale. */
export function drawTools(surface: ViewSurface, overlay: ToolOverlay, zoom: number): void {
  if (overlay.measure) drawMeasurement(surface, overlay.measure, zoom);
  const ruler = overlay.ruler;
  if (ruler) {
    drawPath(surface, ruler.points);
    // The dragged token covers the end; the start and waypoints stay marked.
    for (const point of ruler.points.slice(0, -1)) drawPoint(surface, point);
    const middle = pathMidpoint(ruler.points);
    if (middle) drawLabel(surface, ruler.label, middle, zoom);
  }
  for (const laser of overlay.lasers) drawLaser(surface, laser.trail, laser.color, zoom);
}

function drawMeasurement(surface: ViewSurface, measure: MeasureOverlay, zoom: number): void {
  const { start, end } = measure;
  if (measure.shape === 'line') {
    drawPath(surface, [start, end]);
    drawPoint(surface, end);
  } else if (measure.shape === 'circle') {
    drawCircle(surface, start, Math.hypot(end.x - start.x, end.y - start.y));
  } else {
    drawCone(surface, start, end, measure.coneOpening, zoom);
  }
  drawPoint(surface, start);
  drawLabel(surface, measure.label, measureLabelAnchor(start, end, zoom), zoom);
}

function drawPath(surface: ViewSurface, points: readonly ScenePoint[]): void {
  if (points.length < 2) return;
  for (const stroke of MEASURE_PATH_STROKES) {
    surface.paths([points], false, { stroke: stroke.shadow ? SHADOW : MEASURE_ACCENT, lineWidth: stroke.width, alpha: stroke.alpha });
  }
}

function drawPoint(surface: ViewSurface, point: ScenePoint): void {
  const { radius, halo, haloAlpha, fillAlpha, ringInset, ringWidth } = MEASURE_POINT;
  surface.circle(point.x, point.y, radius + halo, { fill: SHADOW, alpha: haloAlpha });
  surface.circle(point.x, point.y, radius, { fill: MEASURE_ACCENT, alpha: fillAlpha });
  surface.circle(point.x, point.y, radius - ringInset, { stroke: MEASURE_ACCENT, lineWidth: ringWidth });
}

function drawCircle(surface: ViewSurface, center: ScenePoint, radius: number): void {
  const { fillAlpha, strokeWidth, strokeAlpha, highlightWidth, highlightInset } = MEASURE_AREA;
  surface.circle(center.x, center.y, radius, { fill: MEASURE_ACCENT, alpha: fillAlpha });
  surface.circle(center.x, center.y, radius, { stroke: MEASURE_ACCENT, lineWidth: strokeWidth, alpha: strokeAlpha });
  surface.circle(center.x, center.y, Math.max(0, radius - highlightInset), { stroke: MEASURE_ACCENT, lineWidth: highlightWidth });
}

function drawCone(surface: ViewSurface, start: ScenePoint, end: ScenePoint, opening: number, zoom: number): void {
  const cone = coneGeometry(start, end, opening);
  const pixels = cone.radius * zoom * opening;
  const segments = Math.min(MAX_ARC_SEGMENTS, Math.max(MIN_ARC_SEGMENTS, Math.ceil(pixels / ARC_PIXELS_PER_SEGMENT)));
  const arc = arcPoints(start, cone.radius, cone.startAngle, cone.endAngle, segments);
  surface.paths([[start, ...arc]], true, { fill: MEASURE_ACCENT, alpha: MEASURE_AREA.fillAlpha });
  surface.paths([[start, cone.left], [start, cone.right], arc], false, {
    stroke: MEASURE_ACCENT, lineWidth: MEASURE_AREA.strokeWidth, alpha: MEASURE_AREA.strokeAlpha,
  });
}

/** The label on Atlas's dark-theme pill; the page has no Obsidian theme. */
function drawLabel(surface: ViewSurface, text: string, center: ScenePoint, zoom: number): void {
  const size = measureLabelFontSize(zoom);
  const font = `${size}px ${LABEL_FONT_FAMILY}`;
  const box = measureLabelBox(surface.measureText(text, font), size * LABEL_LINE_HEIGHT, center, zoom);
  const theme = MEASURE_LABEL_COLORS.dark;
  surface.roundRect(box.x, box.y, box.width, box.height, box.radius, { fill: cssColor(theme.fill), alpha: MEASURE_LABEL_COLORS.fillAlpha });
  surface.roundRect(box.x, box.y, box.width, box.height, box.radius, {
    stroke: cssColor(theme.stroke), alpha: theme.strokeAlpha, lineWidth: box.strokeWidth,
  });
  surface.text(text, center.x, center.y, { font, color: LABEL_TEXT, align: 'center' });
}

function drawLaser(surface: ViewSurface, trail: readonly BeamPoint[], color: string, zoom: number): void {
  const { halfWidth, bodyShare } = beamWidth(DEFAULT_LASER_POINTER_SETTINGS.size, zoom);
  const points = smoothBeam(trail, beamSmoothingSpacing(halfWidth, zoom));
  const body = (point: BeamPoint): number => beamRadius(point, halfWidth) * bodyShare;
  for (const share of [1, FILAMENT_SHARE]) {
    const stroke = share === 1 ? color : FILAMENT;
    // A laser held still is a single point: a round spot.
    const single = points.length === 1 ? points[0]! : null;
    if (single && body(single) > 0) surface.circle(single.x, single.y, body(single) * share, { fill: stroke });
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const radius = ((body(a) + body(b)) / 2) * share;
      if (radius > 0) surface.paths([[a, b]], false, { stroke, lineWidth: radius * 2, round: true });
    }
  }
}
