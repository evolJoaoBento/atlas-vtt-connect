/**
 * What the player's tools draw over the scene, above the fog as Atlas draws its measurements and
 * lasers: the measurement, the drag ruler, then everyone's lasers. Lines, points and labels
 * follow Atlas's measure drawing (`measureGeometry.ts`). Lasers are Atlas's WebGL beam (`laserRaster.ts`): glow, body
 * and white-hot filament, fading as they age, with a hot spot where a laser is held, at the default size. Shared with
 * the web page.
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
import { rasterBeam } from './laserRaster';
import type { ViewSurface } from '../ViewSurface';
import type { MeasureOverlay } from './MeasureTool';
import type { PlayerTools, ToolOverlay } from './PlayerTools';
import { ringRadius, type PingRing } from '../../tools/pings';
import { conePoints, type MapTemplate } from '../../tools/templates';

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
    draw: (surface, frame) => drawTools(surface, tools.overlay(), frame.zoom, frame.pixel),
    animating: () => tools.isAnimating(),
  };
}

/** `zoom`: screen pixels per world unit, as Atlas's viewport scale; `pixel`: a device pixel's size in world units. */
export function drawTools(surface: ViewSurface, overlay: ToolOverlay, zoom: number, pixel = zoom > 0 ? 1 / zoom : 1): void {
  if (overlay.measure) drawMeasurement(surface, overlay.measure, zoom);
  const ruler = overlay.ruler;
  if (ruler) {
    drawPath(surface, ruler.points);
    // The dragged token covers the end; the start and waypoints stay marked.
    for (const point of ruler.points.slice(0, -1)) drawPoint(surface, point);
    const middle = pathMidpoint(ruler.points);
    if (middle) drawLabel(surface, ruler.label, middle, zoom);
  }
  for (const template of overlay.templates) drawTemplate(surface, template, zoom, overlay.coneOpening);
  for (const laser of overlay.lasers) drawLaser(surface, laser.trail, laser.head, laser.color, zoom, pixel);
  for (const ring of overlay.pings) drawPingRing(surface, ring, zoom);
}

/** A lasting template: its area filled faintly in its owner's colour and outlined; a line is a broad translucent stroke. */
function drawTemplate(surface: ViewSurface, template: MapTemplate, zoom: number, coneOpening: number): void {
  const unit = zoom > 0 ? 1 / zoom : 1;
  const { start, end, color } = template;
  if (template.shape === 'circle') {
    const radius = Math.hypot(end.x - start.x, end.y - start.y);
    surface.circle(start.x, start.y, radius, { fill: color, alpha: 0.18 });
    surface.circle(start.x, start.y, radius, { stroke: color, lineWidth: 2 * unit, alpha: 0.8 });
  } else if (template.shape === 'cone') {
    const outline = conePoints(start, end, coneOpening);
    surface.paths([outline], true, { fill: color, alpha: 0.18 });
    surface.paths([outline], true, { stroke: color, lineWidth: 2 * unit, alpha: 0.8 });
  } else {
    surface.paths([[start, end]], false, { stroke: color, lineWidth: 6 * unit, alpha: 0.5 });
  }
}

/** One ring of a ping: a circle of constant screen size that grows and fades. */
function drawPingRing(surface: ViewSurface, ring: PingRing, zoom: number): void {
  const scale = zoom > 0 ? 1 / zoom : 1;
  surface.circle(ring.x, ring.y, ringRadius(ring.grown) * scale, { stroke: ring.color, lineWidth: 3 * scale, alpha: ring.alpha });
}

/** In the player's colour, as Atlas shows a player's measure. */
function drawMeasurement(surface: ViewSurface, measure: MeasureOverlay, zoom: number): void {
  const { start, end, color } = measure;
  if (measure.shape === 'line') {
    drawPath(surface, [start, end], color);
    drawPoint(surface, end, color);
  } else if (measure.shape === 'circle') {
    drawCircle(surface, start, Math.hypot(end.x - start.x, end.y - start.y), color);
  } else {
    drawCone(surface, start, end, measure.coneOpening, zoom, color);
  }
  drawPoint(surface, start, color);
  drawLabel(surface, measure.label, measureLabelAnchor(start, end, zoom), zoom);
}

function drawPath(surface: ViewSurface, points: readonly ScenePoint[], color: string = MEASURE_ACCENT): void {
  if (points.length < 2) return;
  for (const stroke of MEASURE_PATH_STROKES) {
    surface.paths([points], false, { stroke: stroke.shadow ? SHADOW : color, lineWidth: stroke.width, alpha: stroke.alpha });
  }
}

function drawPoint(surface: ViewSurface, point: ScenePoint, color: string = MEASURE_ACCENT): void {
  const { radius, halo, haloAlpha, fillAlpha, ringInset, ringWidth } = MEASURE_POINT;
  surface.circle(point.x, point.y, radius + halo, { fill: SHADOW, alpha: haloAlpha });
  surface.circle(point.x, point.y, radius, { fill: color, alpha: fillAlpha });
  surface.circle(point.x, point.y, radius - ringInset, { stroke: color, lineWidth: ringWidth });
}

function drawCircle(surface: ViewSurface, center: ScenePoint, radius: number, color: string): void {
  const { fillAlpha, strokeWidth, strokeAlpha, highlightWidth, highlightInset } = MEASURE_AREA;
  surface.circle(center.x, center.y, radius, { fill: color, alpha: fillAlpha });
  surface.circle(center.x, center.y, radius, { stroke: color, lineWidth: strokeWidth, alpha: strokeAlpha });
  surface.circle(center.x, center.y, Math.max(0, radius - highlightInset), { stroke: color, lineWidth: highlightWidth });
}

function drawCone(surface: ViewSurface, start: ScenePoint, end: ScenePoint, opening: number, zoom: number, color: string): void {
  const cone = coneGeometry(start, end, opening);
  const pixels = cone.radius * zoom * opening;
  const segments = Math.min(MAX_ARC_SEGMENTS, Math.max(MIN_ARC_SEGMENTS, Math.ceil(pixels / ARC_PIXELS_PER_SEGMENT)));
  const arc = arcPoints(start, cone.radius, cone.startAngle, cone.endAngle, segments);
  surface.paths([[start, ...arc]], true, { fill: color, alpha: MEASURE_AREA.fillAlpha });
  surface.paths([[start, cone.left], [start, cone.right], arc], false, {
    stroke: color, lineWidth: MEASURE_AREA.strokeWidth, alpha: MEASURE_AREA.strokeAlpha,
  });
}

/** The smallest a ruler's label is on screen, in CSS pixels (Atlas's online `MIN_LABEL_PX`): the size it has at zoom 1. */
export const MIN_LABEL_PX = 16;

/**
 * The label on Atlas's dark-theme pill; the page has no Obsidian theme. Atlas's size, but never smaller on screen than
 * `MIN_LABEL_PX` (Atlas's online `readableLabelFontSize`): a player's view, fitted to the whole map, sits where Atlas's
 * cap would shrink it to dots.
 */
function drawLabel(surface: ViewSurface, text: string, center: ScenePoint, zoom: number): void {
  const size = Math.max(measureLabelFontSize(zoom), MIN_LABEL_PX / (zoom || 1));
  const font = `${size}px ${LABEL_FONT_FAMILY}`;
  const box = measureLabelBox(surface.measureText(text, font), size * LABEL_LINE_HEIGHT, center, zoom);
  const theme = MEASURE_LABEL_COLORS.dark;
  surface.roundRect(box.x, box.y, box.width, box.height, box.radius, { fill: cssColor(theme.fill), alpha: MEASURE_LABEL_COLORS.fillAlpha });
  surface.roundRect(box.x, box.y, box.width, box.height, box.radius, {
    stroke: cssColor(theme.stroke), alpha: theme.strokeAlpha, lineWidth: box.strokeWidth,
  });
  surface.text(text, center.x, center.y, { font, color: LABEL_TEXT, align: 'center' });
}

/** `head`: where the laser is held, its hot spot. */
function drawLaser(surface: ViewSurface, trail: readonly BeamPoint[], head: ScenePoint | null, color: string, zoom: number, pixel: number): void {
  const { halfWidth, bodyShare } = beamWidth(DEFAULT_LASER_POINTER_SETTINGS.size, zoom);
  const points = smoothBeam(trail, beamSmoothingSpacing(halfWidth, zoom));
  const raster = rasterBeam(points, null, { color, halfWidth, bodyShare, pointer: head }, pixel > 0 ? 1 / pixel : zoom);
  if (raster) {
    surface.raster(raster.image, raster.x, raster.y, raster.width, raster.height);
    return;
  }
  // Too wide to work out by pixel: Atlas's Canvas-renderer beam (`CanvasLaserBeam`), body and filament without the glow.
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
