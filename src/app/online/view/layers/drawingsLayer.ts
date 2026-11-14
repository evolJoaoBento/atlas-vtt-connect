/**
 * Atlas's drawings: ink in its order and icon stamps, as `DrawingRenderer` draws them; from Atlas 0.16, a closed
 * drawing's fill (its holes cut out) under its line, a line of no width as none, stamps by a pin symbol and turned.
 * Eraser records are skipped: Atlas's eraser splits or deletes strokes in the store (0.16 reads none).
 */
import type { WorldBounds } from '../../scene/FogCoverage';
import { drawingBounds } from '../../scene/objectBounds';
import { sortedByOrder, type PlayerDrawing } from '../../scene/sceneTypes';
import { intersects } from '../camera';
import { pinIcons } from '../../../../../packages/atlas-shared/src/index';
import type { PlayerLayer } from './layerTypes';

export function createDrawingsLayer(): PlayerLayer {
  // A drawing's bounds are computed once per record, not on every frame.
  const bounds = new WeakMap<PlayerDrawing, WorldBounds>();
  const boundsOf = (drawing: PlayerDrawing): WorldBounds => {
    let known = bounds.get(drawing);
    if (!known) {
      known = drawingBounds(drawing);
      bounds.set(drawing, known);
    }
    return known;
  };
  // Sorted once per change of the drawings, not on every frame.
  let sorted: { drawings: Readonly<Record<string, PlayerDrawing>>; list: PlayerDrawing[] } | null = null;
  const inOrder = (drawings: Readonly<Record<string, PlayerDrawing>>): PlayerDrawing[] => {
    if (sorted === null || sorted.drawings !== drawings) {
      sorted = { drawings, list: sortedByOrder(drawings, (drawing) => drawing.order).map(([, drawing]) => drawing) };
    }
    return sorted.list;
  };
  return {
    draw(surface, frame): void {
      for (const drawing of inOrder(frame.scene.drawings)) {
        const [first] = drawing.points;
        if (!first || drawing.type === 'eraser' || !intersects(boundsOf(drawing), frame.visible)) continue;
        if (drawing.type === 'icon') {
          if (drawing.icon === null) continue;
          const turn = ((drawing.rotation ?? 0) * Math.PI) / 180;
          // A pin symbol (Atlas 0.16's stamps), else one of the twelve stamp symbols of before.
          if (Object.hasOwn(pinIcons.PIN_ICON_PATHS, drawing.icon)) {
            surface.push(first.x, first.y, turn, 1);
            surface.pinGlyph(drawing.icon, 0, 0, drawing.width, drawing.color);
            surface.pop();
          } else if (turn !== 0) {
            surface.push(first.x, first.y, turn, 1);
            surface.icon(drawing.icon, 0, 0, drawing.width, drawing.color, drawing.opacity);
            surface.pop();
          } else surface.icon(drawing.icon, first.x, first.y, drawing.width, drawing.color, drawing.opacity);
          continue;
        }
        if (drawing.fill) surface.paths([drawing.points, ...(drawing.holes ?? [])], true, { fill: drawing.color, alpha: drawing.opacity * (drawing.fill === 'soft' ? 0.25 : 1), evenOdd: true });
        if (!(drawing.width > 0)) continue;
        if (drawing.points.length === 1) {
          surface.circle(first.x, first.y, drawing.width / 2, { fill: drawing.color, alpha: drawing.opacity });
        } else {
          surface.paths([drawing.points], false, { stroke: drawing.color, lineWidth: drawing.width, alpha: drawing.opacity, round: true });
        }
      }
    },
  };
}
