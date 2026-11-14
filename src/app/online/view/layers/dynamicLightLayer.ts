import type { PlayerLightMask, PlayerScene } from '../../scene/sceneTypes';
import type { DynamicLightImage, LayerSurface, ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';

interface Cache { mask: PlayerLightMask; image: DynamicLightImage; layer: LayerSurface | null }

/** Draws the host-rendered mask only; it never receives walls or recomputes visibility. */
export class DynamicLightLayer implements PlayerLayer {
  private cache: Cache | null = null;
  private now = Date.now();
  private lastFlashUntil = 0;
  draw(surface: ViewSurface, { scene, visible }: LayerFrame): void {
    this.now = Date.now();
    const mask = scene.lightMask;
    if (!mask) this.clear();
    else {
      if (this.cache?.mask !== mask) this.rebuild(surface, mask, scene);
      if (this.cache?.layer) surface.drawLayer(this.cache.layer, 0, 0, scene.map.width, scene.map.height);
      else if (this.cache) surface.dynamicLight(this.cache.image, 0, 0, scene.map.width, scene.map.height);
    }
    const flash = scene.lightFlash;
    this.lastFlashUntil = flash?.until ?? 0;
    if (flash && flash.until > this.now && flash.x >= visible.x - visible.width && flash.x <= visible.x + visible.width * 2 && flash.y >= visible.y - visible.height && flash.y <= visible.y + visible.height * 2) {
      const radius = scene.map.cellSize * 20 / scene.measurement.unitDistance;
      surface.circle(flash.x, flash.y, radius, { fill: '#fff3c4', alpha: Math.min(0.85, (flash.until - this.now) / 800), gradient: { from: { x: flash.x, y: flash.y }, to: { x: flash.x + radius, y: flash.y }, stops: [[0, 'rgba(255,248,220,0.95)'], [1, 'rgba(255,190,80,0)']] } });
    }
  }
  dispose(): void { this.clear(); }
  animating(): boolean { return this.lastFlashUntil > this.now; }
  private clear(): void { this.cache?.layer?.release(); this.cache = null; }
  private rebuild(surface: ViewSurface, mask: PlayerLightMask, _scene: PlayerScene): void {
    this.clear();
    const image = new Image(); image.src = mask.png;
    const entry: Cache = { mask, image: { image, width: mask.width, height: mask.height }, layer: surface.createLayer(mask.width, mask.height) };
    if (entry.layer) {
      entry.layer.begin(mask.width, mask.height, null);
      entry.layer.dynamicLight(entry.image, 0, 0, mask.width, mask.height);
    }
    this.cache = entry;
  }
}
