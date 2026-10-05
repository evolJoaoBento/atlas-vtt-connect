/**
 * Atlas's drawings: ink in its order and icon stamps, as `DrawingRenderer` draws them.
 * Eraser records are skipped: Atlas's eraser splits or deletes strokes in the store.
 */
import type { WorldBounds } from '../../scene/FogCoverage';
import { drawingBounds } from '../../scene/objectBounds';
import { sortedByOrder, type PlayerDrawing } from '../../scene/sceneTypes';
import { intersects } from '../camera';
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
          if (drawing.icon !== null) surface.icon(drawing.icon, first.x, first.y, drawing.width, drawing.color, drawing.opacity);
        } else if (drawing.points.length === 1) {
          surface.circle(first.x, first.y, drawing.width / 2, { fill: drawing.color, alpha: drawing.opacity });
        } else {
          surface.paths([drawing.points], false, { stroke: drawing.color, lineWidth: drawing.width, alpha: drawing.opacity, round: true });
        }
      }
    },
  };
}
