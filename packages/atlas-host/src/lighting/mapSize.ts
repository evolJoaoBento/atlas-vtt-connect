import type { MapSize } from './darknessRaster';

interface SizedRenderer {
  getMapImage?: () => { worldRect?: { width: number; height: number } | null } | null | undefined;
  getBackgroundSprite?: () => { destroyed?: boolean; width: number; height: number } | null | undefined;
}

/** The loaded background's size in world pixels of an Atlas map view; 0 × 0 while none is loaded. */
export function atlasMapSize(view: { readonly renderer?: unknown }): MapSize {
  const renderer = (typeof view.renderer === 'object' && view.renderer !== null ? view.renderer : {}) as SizedRenderer;
  const rect = renderer.getMapImage?.()?.worldRect ?? null;
  if (rect && rect.width > 0 && rect.height > 0) return { width: rect.width, height: rect.height };
  const sprite = renderer.getBackgroundSprite?.() ?? null;
  return sprite && !sprite.destroyed && sprite.width > 0 && sprite.height > 0 ? { width: sprite.width, height: sprite.height } : { width: 0, height: 0 };
}
