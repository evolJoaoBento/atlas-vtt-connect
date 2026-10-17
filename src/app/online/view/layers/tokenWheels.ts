/**
 * A token's resource wheels as the player window draws them, at rest beside the token (Atlas's `ResourceWheels`,
 * `ResourceWheelView`, `wheelGeometry`, `wheelAnchor`): sockets 2 and 3 on the token's right, 4 and 5 mirrored on its
 * left, the first of a side the upper one, standing on the nameplate's top line past the resize button's place. Each is
 * the bars' border and dark track round a ring gauge filled clockwise from the top in the resource's colour, divided
 * into one segment per point for a whole maximum from 2 to 8, with the current number (a static resource's maximum, in
 * a whole ring) in the middle. Shared with the web page.
 */
import { BAR_BORDER, BAR_STYLE, NAMEPLATE_HEIGHT, RESIZE_HANDLE_SIZE, restingTokenUIScale, tokenUIScale } from '@atlas-vtt/shared/draw';
import type { PlayerWheel, ScenePoint } from '../../scene/sceneTypes';
import type { ViewSurface } from '../ViewSurface';

/** Atlas's wheel numbers (`ResourceWheelView`, `ResourceWheels`), in UI units. */
export const WHEEL = {
  size: 20.4,
  ringWidth: 3,
  tickWidth: 0.8,
  gap: 1.6,
  margin: 1.5,
  /** A whole maximum from two up to this many points is divided into one segment per point. */
  maxSegments: 8,
  /** Characters that fit across the ring's hole at full size. */
  fullSizeCharacters: 2,
} as const;
/** How far a bar's fill is set in from its track (`BAR_FILL_INSET`); the ring is set in as far. */
const FILL_INSET = 1;
const RING_RADIUS = WHEEL.size / 2 - BAR_BORDER / 2 - FILL_INSET - WHEEL.ringWidth / 2;
/** The bottom of the lower wheel above the anchor: clear of the nameplate on the token's bottom edge. */
const WHEEL_BASE = NAMEPLATE_HEIGHT + 1;
const WHEELS_PER_SIDE = 2;
const FIRST_WHEEL_SLOT = 2;
const TOP = -Math.PI / 2;
/** Atlas's resource numbers (`RESOURCE_NUMBER_STYLE`), set large and scaled down so they stay crisp. */
export const WHEEL_NUMBER = {
  font: '600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial',
  color: '#ffffff',
  outline: { color: '#000000', width: 2 },
  scale: 0.333,
} as const;
/** Points along a full turn of the ring: smooth at any zoom a wheel is read at. */
const ARC_STEPS = 48;

const css = (color: number): string => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;

/** The centre of the wheel in `slot`, in its side's anchor units, and the side it hangs on. */
export function wheelCentre(slot: number): { x: number; y: number; left: boolean } {
  const index = slot - FIRST_WHEEL_SLOT;
  const left = index >= WHEELS_PER_SIDE;
  const row = index % WHEELS_PER_SIDE === 0 ? 1 : 0;
  const x = left ? -WHEEL.margin - WHEEL.size / 2 : WHEEL.margin + WHEEL.size / 2;
  const y = -WHEEL_BASE - WHEEL.size - row * (WHEEL.gap + WHEEL.size) + WHEEL.size / 2;
  return { x, y, left };
}

/** Where the filled share of a wheel ends and its segments are divided, in radians clockwise from the top. */
export function wheelGauge(wheel: PlayerWheel): { share: number; ticks: number[] } | null {
  if (wheel.fixed) return { share: 1, ticks: [] };
  const { current, max } = wheel;
  if (!(max > 0)) return null;
  const share = Math.max(0, Math.min(1, current / max));
  const segmented = Number.isInteger(max) && max > 1 && max <= WHEEL.maxSegments;
  return { share, ticks: segmented ? Array.from({ length: max }, (_, i) => TOP + ((Math.PI * 2) / max) * i) : [] };
}

/**
 * Draws `wheels` beside a token centred at (x, y) `size` wide, whose ring band's centre is `ringRadius` out. The anchors
 * sit past the resize button (`wheelAnchor`), on the token's bottom edge, scaled as the bars.
 */
export function drawWheels(
  surface: ViewSurface, at: ScenePoint, wheels: readonly PlayerWheel[], size: number, ringRadius: number, cellSize: number, uiScale?: number,
): void {
  if (wheels.length === 0) return;
  const anchorX = ringRadius + (RESIZE_HANDLE_SIZE / 2) * tokenUIScale(size);
  const scale = uiScale ?? restingTokenUIScale(cellSize);
  for (const wheel of wheels) {
    const centre = wheelCentre(wheel.slot);
    surface.push(at.x + (centre.left ? -anchorX : anchorX), at.y + size / 2, 0, scale);
    drawWheel(surface, centre.x, centre.y, wheel);
    surface.pop();
  }
}

function drawWheel(surface: ViewSurface, x: number, y: number, wheel: PlayerWheel): void {
  const outer = WHEEL.size / 2;
  // Border and track as on a bar: the track covers the inner half of the border's stroke.
  surface.circle(x, y, outer, { stroke: css(BAR_STYLE.border), lineWidth: BAR_BORDER });
  surface.circle(x, y, outer - BAR_BORDER / 2, { fill: css(BAR_STYLE.inside) });
  surface.circle(x, y, RING_RADIUS, { stroke: css(BAR_STYLE.tick), lineWidth: WHEEL.ringWidth, alpha: BAR_STYLE.tickAlpha });
  const gauge = wheelGauge(wheel);
  if (gauge) {
    if (gauge.share >= 1) {
      // A full ring is a circle: an arc that ends where it began leaves a seam.
      surface.circle(x, y, RING_RADIUS, { stroke: wheel.color, lineWidth: WHEEL.ringWidth });
    } else if (gauge.share > 0) {
      const steps = Math.max(2, Math.ceil(ARC_STEPS * gauge.share));
      const end = TOP + Math.PI * 2 * gauge.share;
      const arc: ScenePoint[] = [];
      for (let step = 0; step <= steps; step++) {
        const angle = TOP + ((end - TOP) * step) / steps;
        arc.push({ x: x + Math.cos(angle) * RING_RADIUS, y: y + Math.sin(angle) * RING_RADIUS });
      }
      surface.paths([arc], false, { stroke: wheel.color, lineWidth: WHEEL.ringWidth });
    }
    const half = WHEEL.ringWidth / 2;
    const ticks = gauge.ticks.map((angle) => [
      { x: x + Math.cos(angle) * (RING_RADIUS - half), y: y + Math.sin(angle) * (RING_RADIUS - half) },
      { x: x + Math.cos(angle) * (RING_RADIUS + half), y: y + Math.sin(angle) * (RING_RADIUS + half) },
    ]);
    if (ticks.length > 0) surface.paths(ticks, false, { stroke: css(BAR_STYLE.inside), lineWidth: WHEEL.tickWidth });
  }
  const label = String(wheel.fixed ? wheel.max : wheel.current);
  surface.push(x, y, 0, WHEEL_NUMBER.scale * Math.min(1, WHEEL.fullSizeCharacters / label.length));
  surface.text(label, 0, 0, { font: WHEEL_NUMBER.font, color: WHEEL_NUMBER.color, align: 'center', outline: WHEEL_NUMBER.outline });
  surface.pop();
}
