/**
 * Atlas's fog, drawn last and opaque. The fog is rendered once into a cached image of
 * the map area (at most 4096 px on its long side) and redrawn only when the fog
 * changes, so panning and zooming over thousands of strokes stays cheap. Erasing cuts
 * out of the image like Atlas's compositor (`destination-out`).
 */
import { FOG_COLOR } from '@atlas-vtt/shared/draw';
import { fogShapes, type FogShape } from '../../preview/previewShapes';
import type { PlayerFogOp, PlayerScene } from '../../scene/sceneTypes';
import { intersects, type WorldRect } from '../camera';
import type { LayerSurface, ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';

/** The fog image's long side, in pixels, at most. */
export const FOG_CACHE_MAX_SIDE = 4096;

interface FogCache {
  fog: Readonly<Record<string, PlayerFogOp>>;
  mapWidth: number;
  mapHeight: number;
  area: WorldRect | null;
  layer: LayerSurface | null;
}

/** The fog image's world area: the map, or without a map size the extent of the fog itself. */
export function fogArea(scene: PlayerScene, shapes: readonly FogShape[]): WorldRect | null {
  if (scene.map.width > 0 && scene.map.height > 0) return { x: 0, y: 0, width: scene.map.width, height: scene.map.height };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const add = (x: number, y: number, pad: number): void => {
    left = Math.min(left, x - pad);
    top = Math.min(top, y - pad);
    right = Math.max(right, x + pad);
    bottom = Math.max(bottom, y + pad);
  };
  for (const shape of shapes) {
    if (shape.kind === 'rect') {
      add(shape.x, shape.y, 0);
      add(shape.x + shape.width, shape.y + shape.height, 0);
    } else {
      const pad = shape.kind === 'stroke' ? shape.width / 2 : 0;
      for (const point of shape.points) add(point.x, point.y, pad);
    }
  }
  return left < right && top < bottom ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

export class FogLayer implements PlayerLayer {
  private cache: FogCache | null = null;
  /** How many times the fog image was painted; tests read it. */
  rebuilds = 0;

  draw(surface: ViewSurface, frame: LayerFrame): void {
    const { fog, map } = frame.scene;
    const cache = this.cache;
    if (!cache || cache.fog !== fog || cache.mapWidth !== map.width || cache.mapHeight !== map.height) this.rebuild(surface, frame.scene);
    const area = this.cache?.area ?? null;
    const layer = this.cache?.layer ?? null;
    if (area && layer && intersects(area, frame.visible)) surface.drawLayer(layer, area.x, area.y, area.width, area.height);
  }

  dispose(): void {
    this.cache?.layer?.release();
    this.cache = null;
  }

  private rebuild(surface: ViewSurface, scene: PlayerScene): void {
    this.dispose();
    const shapes = fogShapes(scene.fog);
    const area = shapes.length > 0 ? fogArea(scene, shapes) : null;
    const layer = area ? this.paint(surface, shapes, area) : null;
    this.cache = { fog: scene.fog, mapWidth: scene.map.width, mapHeight: scene.map.height, area, layer };
  }

  private paint(surface: ViewSurface, shapes: readonly FogShape[], area: WorldRect): LayerSurface | null {
    const scale = Math.min(1, FOG_CACHE_MAX_SIDE / Math.max(area.width, area.height));
    const width = Math.max(1, Math.round(area.width * scale));
    const height = Math.max(1, Math.round(area.height * scale));
    const layer = surface.createLayer(width, height);
    if (!layer) return null;
    this.rebuilds++;
    layer.begin(width, height, null);
    layer.setCamera(scale, 0 - area.x * scale, 0 - area.y * scale);
    for (const shape of shapes) paintShape(layer, shape);
    return layer;
  }
}

function paintShape(surface: ViewSurface, shape: FogShape): void {
  const base = { erase: shape.erase, round: true };
  if (shape.kind === 'rect') {
    surface.rect(shape.x, shape.y, shape.width, shape.height, { ...base, fill: FOG_COLOR });
    return;
  }
  if (shape.kind === 'polygon') {
    surface.paths([shape.points], true, { ...base, fill: FOG_COLOR });
    return;
  }
  const [only] = shape.points;
  if (shape.points.length === 1 && only) surface.circle(only.x, only.y, shape.width / 2, { ...base, fill: FOG_COLOR });
  else surface.paths([shape.points], false, { ...base, stroke: FOG_COLOR, lineWidth: shape.width });
}
