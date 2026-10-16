/**
 * The note pins the GM made readable (`PlayerScene.pins`), drawn as Atlas's `PinRenderer` draws pins: a round badge in
 * the theme's colours with the pin's icon in its tone, or its number or letter, and the readable mark (an open book) on
 * its rim, at Atlas's map marker size (`mapMarkerScale`), over the scene and its fog (only pins where players see the map
 * are sent). The note's title shows in the card under the mouse (`pinAt`). Shared with the web page.
 */
import type { PlayerPin, PlayerScene, ScenePoint } from '../../scene/sceneTypes';
import { PIN_ICON_TONES } from '../pinIcons';
import type { ViewSurface } from '../ViewSurface';
import type { OverlayLayer } from './layerTypes';

/** Atlas's pin badge (`pinSize`), in marker units. */
export const PIN_BADGE_RADIUS = 20;
const PIN_ICON_SIZE = 22;
/** Atlas's badge colours (`canvasBadgeColors`): paper and ink per theme. */
const BADGE_COLORS = { dark: { background: '#2a2a2a', stroke: '#ffffff' }, light: { background: '#e3e3e3', stroke: '#000000' } } as const;
/** The readable mark's radius, on the badge's rim up and to the right (`pinReadableMark.ts`). */
const MARK_RADIUS = 9;
/** Below this zoom, markers grow on screen instead of keeping their size. */
const BOOST_ZOOM = 0.2;

/** Atlas's `mapMarkerScale`: world units per marker unit at viewport `zoom`, constant on screen, larger when zoomed far out. */
export function mapMarkerScale(zoom: number): number {
  const inverse = 1 / (zoom > 0 ? zoom : 1);
  if (zoom >= BOOST_ZOOM) return Math.max(0.15, inverse);
  const boostInverse = 1 / BOOST_ZOOM;
  return boostInverse * Math.pow(inverse / boostInverse, 1.21);
}

export function createPinsLayer(): OverlayLayer {
  return {
    draw(surface, frame): void {
      const pins = frame.scene.pins ?? [];
      if (pins.length === 0) return;
      const scale = mapMarkerScale(frame.zoom);
      const dark = frame.dark ?? true;
      for (const pin of pins) {
        surface.push(pin.x, pin.y, 0, scale);
        drawPin(surface, pin, dark);
        surface.pop();
      }
    },
    animating: () => false,
  };
}

function drawPin(surface: ViewSurface, pin: PlayerPin, dark: boolean): void {
  const colors = dark ? BADGE_COLORS.dark : BADGE_COLORS.light;
  surface.circle(0, 0, PIN_BADGE_RADIUS, { fill: colors.background, alpha: 0.95 });
  surface.circle(0, 0, PIN_BADGE_RADIUS, { stroke: colors.stroke, lineWidth: 0.5, alpha: dark ? 0.4 : 0.3 });
  const icon = pin.icon;
  const labelled = icon === 'number' || icon === 'letter' || (icon === undefined && pin.label !== null);
  if (labelled) {
    const text = pin.label ?? '';
    const font = `bold ${PIN_BADGE_RADIUS}px Arial, sans-serif`;
    // Longer labels ("12", "AB") shrink to stay inside the badge.
    const fit = Math.min(1, (PIN_BADGE_RADIUS * 1.5) / Math.max(1, surface.measureText(text, font)));
    surface.push(0, 0, 0, fit);
    surface.text(text, 0, 0, { font, color: colors.stroke, align: 'center' });
    surface.pop();
  } else {
    const tone = PIN_ICON_TONES[icon ?? 'pin'] ?? PIN_ICON_TONES.pin!;
    surface.pinGlyph(icon ?? 'pin', 0, 0, PIN_ICON_SIZE, dark ? tone.dark : tone.light);
  }
  // Every pin players get is readable: the GM's mark that its note may be read.
  const at = PIN_BADGE_RADIUS * Math.SQRT1_2;
  surface.push(at, -at, 0, 1);
  surface.circle(0, 0, MARK_RADIUS, { fill: colors.stroke });
  surface.circle(0, 0, MARK_RADIUS, { stroke: colors.background, lineWidth: 1.5 });
  // Two pages meeting at the spine, each a little higher at its outer edge.
  surface.paths([
    [{ x: -0.7, y: -2.8 }, { x: -5.6, y: -4.2 }, { x: -5.6, y: 3.4 }, { x: -0.7, y: 4.6 }],
    [{ x: 0.7, y: -2.8 }, { x: 5.6, y: -4.2 }, { x: 5.6, y: 3.4 }, { x: 0.7, y: 4.6 }],
  ], true, { fill: colors.background });
  surface.pop();
}

/** The pin under a world point, at `zoom` screen pixels per world unit; null when none is within its marker. */
export function pinAt(scene: PlayerScene, point: ScenePoint, zoom: number): PlayerPin | null {
  const reach = PIN_BADGE_RADIUS * mapMarkerScale(zoom);
  let best: { pin: PlayerPin; distance: number } | null = null;
  for (const pin of scene.pins ?? []) {
    const distance = Math.hypot(point.x - pin.x, point.y - pin.y);
    if (distance <= reach && (!best || distance < best.distance)) best = { pin, distance };
  }
  return best?.pin ?? null;
}
