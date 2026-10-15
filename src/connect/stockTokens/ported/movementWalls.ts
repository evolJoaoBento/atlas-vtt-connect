// Ported unchanged from Atlas VTT src/app/online/movement/movementWalls.ts (0.8.0; identical in 0.7.1). AGPL-3.0, like this plugin. Only imports were rewritten.
import { BASE_TEXEL, fieldMargin, wallRadius, worldTexel } from './lightingConstants';
import { sealedWalls } from './sealWalls';
import { blocksNothing, segOf } from './segments';
import type { WallSegment } from './types';
import { moveWallsOf, type MoveWalls } from './wallCollision';

/** A map's size in world pixels: its image lies at (0, 0) at its natural size. */
export interface MapSize {
  readonly width: number;
  readonly height: number;
}

const built = new WeakMap<readonly WallSegment[], Map<number, MoveWalls>>();

/**
 * The walls that stop a player's token, from a scene's walls as `wallList` reads them: every wall but
 * an open door (one that is shrunk to a point stops nothing either). A closed door stops it, locked
 * or not, and so do walls that let sight or light through, one-way walls from both sides and limited
 * walls: a player never gets where the walls keep them out of. The bridges with which the lighting
 * seals small gaps (`sealedWalls`, at the map's texel) stop it too, so no gap the lighting closes can
 * be slipped through. A stopped token's centre stays outside the wall's capsule as the lighting draws it.
 * The same object comes back for as long as the list and the map's texel are the same.
 */
export function movementWalls(walls: readonly WallSegment[], map: MapSize | null): MoveWalls {
  const texel = map === null ? BASE_TEXEL : worldTexel(map);
  let byTexel = built.get(walls);
  if (byTexel === undefined) built.set(walls, (byTexel = new Map<number, MoveWalls>()));
  let result = byTexel.get(texel);
  if (result === undefined) {
    const stopping = sealedWalls(walls, texel).filter((wall) => !blocksNothing(wall)).map(segOf);
    result = moveWallsOf(stopping, wallRadius(texel) + fieldMargin(texel));
    byTexel.set(texel, result);
  }
  return result;
}
