/**
 * Atlas's drawings: ink in its order and icon stamps, as `DrawingRenderer` draws them; from Atlas 0.16, a closed
 * drawing's fill (its holes cut out, by the nonzero rule Atlas fills with) under its line, a line of no width as none,
 * stamps by a pin symbol and turned. A drawing on the map's layer (`layer: 'map'`) lies under the grid and the tokens:
 * the map layer draws it (`drawMapDrawings`), this one the rest.
 * Eraser records are skipped: Atlas's eraser splits or deletes strokes in the store (0.16 reads none).
 */
import type { WorldBounds } from '../../scene/FogCoverage';
import { drawingBounds } from '../../scene/objectBounds';
import type { PlayerDrawing, ScenePoint } from '../../scene/sceneTypes';
import { intersects } from '../camera';
import { pinIcons } from '../../../../../packages/atlas-shared/src/index';
import type { ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';

/** Twice a ring's signed area (its winding: the sign). */
const winding = (ring: readonly ScenePoint[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!; const b = ring[(i + 1) % ring.length]!; sum += a.x * b.y - b.x * a.y; }
  return sum;
};

/** One drawing, as Atlas draws it. */
export function drawDrawing(surface: ViewSurface, drawing: PlayerDrawing): void {
  const [first] = drawing.points;
  if (!first || drawing.type === 'eraser') return;
  if (drawing.type === 'icon') {
    if (drawing.icon === null) return;
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
    return;
  }
  if (drawing.fill) {
    // Atlas fills by the nonzero rule: a hole is cut out when it winds against the outline, so each is turned so.
    const outline = winding(drawing.points);
    const holes = (drawing.holes ?? []).map((hole) => (Math.sign(winding(hole)) === Math.sign(outline) ? [...hole].reverse() : hole));
    surface.paths([drawing.points, ...holes], true, { fill: drawing.color, alpha: drawing.opacity * (drawing.fill === 'soft' ? 0.25 : 1) });
  }
  if (!(drawing.width > 0)) return;
  if (drawing.points.length === 1) surface.circle(first.x, first.y, drawing.width / 2, { fill: drawing.color, alpha: drawing.opacity });
  else surface.paths([drawing.points], false, { stroke: drawing.color, lineWidth: drawing.width, alpha: drawing.opacity, round: true });
}

/** The drawings of one place (the map's layer, or above the tokens), in their order, as far as the view shows them. */
function placedLayer(onMap: boolean): (surface: ViewSurface, frame: LayerFrame) => void {
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
      // Atlas 0.16 stacks by its `order` (`stack` here) first, then by the time drawn.
      const list = Object.values(drawings).sort((a, b) => (a.stack ?? 0) - (b.stack ?? 0) || a.order - b.order);
      sorted = { drawings, list: list.filter((drawing) => (drawing.layer === 'map') === onMap) };
    }
    return sorted.list;
  };
  return (surface, frame) => {
    for (const drawing of inOrder(frame.scene.drawings)) if (intersects(boundsOf(drawing), frame.visible)) drawDrawing(surface, drawing);
  };
}

/** The drawings on the map's own layer, drawn by the map layer right after the map: under the grid and the tokens. */
export function createMapDrawings(): (surface: ViewSurface, frame: LayerFrame) => void {
  return placedLayer(true);
}

export function createDrawingsLayer(): PlayerLayer {
  const draw = placedLayer(false);
  return { draw: (surface, frame) => draw(surface, frame) };
}
