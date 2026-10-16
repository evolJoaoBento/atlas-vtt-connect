/**
 * The note pins the GM made readable (`PlayerScene.pins`): a round marker of constant screen size with the pin's
 * number or letter, over the scene and its fog like Atlas's own pins (only pins where players see the map are sent).
 * The note's title shows in the token card under the mouse (`pinAt`). Shared with the web page.
 */
import type { PlayerPin, PlayerScene, ScenePoint } from '../../scene/sceneTypes';
import type { OverlayLayer } from './layerTypes';

/** The marker's radius on screen, in CSS pixels. */
export const PIN_RADIUS = 10;
export const PIN_COLORS = { fill: '#7c5cff', stroke: '#ffffff', text: '#ffffff' } as const;

export function createPinsLayer(): OverlayLayer {
  return {
    draw(surface, frame): void {
      const pins = frame.scene.pins ?? [];
      if (pins.length === 0) return;
      // World units per CSS pixel: markers keep their size on screen whatever the zoom.
      const unit = frame.zoom > 0 ? 1 / frame.zoom : 1;
      for (const pin of pins) {
        surface.circle(pin.x, pin.y, PIN_RADIUS * unit, { fill: PIN_COLORS.fill, stroke: PIN_COLORS.stroke, lineWidth: 2 * unit });
        if (pin.label) {
          surface.push(pin.x, pin.y, 0, unit);
          surface.text(pin.label, 0, 0, { font: 'bold 11px sans-serif', color: PIN_COLORS.text, align: 'center' });
          surface.pop();
        }
      }
    },
    animating: () => false,
  };
}

/** The pin under a world point, at `zoom` screen pixels per world unit; null when none is within its marker. */
export function pinAt(scene: PlayerScene, point: ScenePoint, zoom: number): PlayerPin | null {
  const reach = (PIN_RADIUS + 2) / (zoom > 0 ? zoom : 1);
  let best: { pin: PlayerPin; distance: number } | null = null;
  for (const pin of scene.pins ?? []) {
    const distance = Math.hypot(point.x - pin.x, point.y - pin.y);
    if (distance <= reach && (!best || distance < best.distance)) best = { pin, distance };
  }
  return best?.pin ?? null;
}
