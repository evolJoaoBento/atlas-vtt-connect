/** Atlas's background: the map image at the map's size, a placeholder until it has loaded. */
import { intersects } from '../camera';
import type { PlayerLayer } from './layerTypes';

/** Shown where the map image goes until it has loaded. */
export const MAP_PLACEHOLDER = '#26282c';

export function createMapLayer(): PlayerLayer {
  return {
    draw(surface, frame): void {
      const { map } = frame.scene;
      if (!(map.width > 0) || !(map.height > 0)) return;
      if (!intersects({ x: 0, y: 0, width: map.width, height: map.height }, frame.visible)) return;
      const art = frame.images(map.asset);
      if (art) surface.image(art.image, 0, 0, map.width, map.height, null);
      else surface.rect(0, 0, map.width, map.height, { fill: MAP_PLACEHOLDER });
    },
  };
}
