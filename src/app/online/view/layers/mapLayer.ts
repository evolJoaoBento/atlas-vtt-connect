/** Atlas's background: the map image at the map's size, a placeholder until it has loaded. */
import { intersects } from '../camera';
import type { ViewSurface } from '../ViewSurface';
import type { PlayerLiquid } from '../../scene/sceneTypes';
import type { PlayerLayer } from './layerTypes';

/** Shown where the map image goes until it has loaded. */
export const MAP_PLACEHOLDER = '#26282c';

/** How much of a liquid's colour shows through to the map under it. */
const LIQUID_ALPHA = 0.8;

/**
 * The map's liquids, still: each outline (with its holes cut out) filled with its surface colour over the map image, with
 * a thin glint along its edge. Atlas animates them with a shader; this is their colour and shape.
 */
function drawLiquids(surface: ViewSurface, liquids: readonly PlayerLiquid[], cellSize: number): void {
  for (const { polygon, holes, colors } of liquids) {
    surface.paths([polygon, ...(holes ?? [])], true, { fill: colors.surface, alpha: LIQUID_ALPHA, evenOdd: true });
    surface.paths([polygon, ...(holes ?? [])], true, { stroke: colors.glint, lineWidth: Math.max(1, cellSize * 0.03), alpha: 0.6 });
  }
}

export function createMapLayer(): PlayerLayer {
  /** Whether the last frame drew a video: the layer then asks to be drawn again, as the video moves on its own. */
  let playing = false;
  return {
    animating: () => playing,
    draw(surface, frame): void {
      playing = false;
      const { map } = frame.scene;
      if (!(map.width > 0) || !(map.height > 0)) return;
      if (!intersects({ x: 0, y: 0, width: map.width, height: map.height }, frame.visible)) return;
      // An animated map plays where the view could load its video; until then (and everywhere else) its still shows.
      const clip = frame.images(map.video ?? null);
      const video = clip && 'videoWidth' in clip.image ? clip.image : null;
      if (video) {
        if (video.paused) void video.play().catch(() => undefined);
        playing = true;
      }
      const art = video ? clip : frame.images(map.asset);
      // A map Atlas aligned turned or shifted sits inside its world rect by its matrix; any other fills the rect.
      if (art && map.matrix) surface.imageMatrix(art.image, map.matrix);
      else if (art) surface.image(art.image, 0, 0, map.width, map.height, null);
      else surface.rect(0, 0, map.width, map.height, { fill: MAP_PLACEHOLDER });
      if (map.liquids && map.liquids.length > 0) drawLiquids(surface, map.liquids, map.cellSize);
    },
  };
}
