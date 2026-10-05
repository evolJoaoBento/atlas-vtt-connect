/**
 * Where Atlas draws a note pin, as world bounds the fog must prove revealed before a player-safe share sends it
 * (ruling F-POS). A pin linked to a hex (`hex: true` on a hex grid) shows as its whole hex, highlighted, with the
 * badge at the hex's centre (Atlas's `grid/hexLinks.ts`: `linkedHexOf` is the hex containing the stored point); any
 * other pin is its badge at the stored point.
 *
 * The badge is a deliberate fixed size: Atlas draws pins at a constant size on screen (`mapMarkerScale`, 1/zoom), so
 * their world size depends on each viewer's zoom. `pinSize.badgeRadius` (20 world px) is the badge at zoom 1, the
 * size Atlas lays it out in.
 */
import { pinSize } from '@atlas-vtt/shared/draw';
import { axialToPixel, createHexLayout, hexVertices, isHexGridType, pixelToAxial } from '@atlas-vtt/shared/grid';
import type { GridState } from '@atlas-vtt/api-types';
import type { WorldBounds } from '../../scene/FogCoverage';
import type { NotePin } from './sharedMapFile';

/** The badge's box centred on `x`, `y`. */
function badgeAt(x: number, y: number): WorldBounds {
  const radius = pinSize.badgeRadius;
  return { x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius };
}

/** The bounds Atlas draws `pin` in on a map with `grid`: its hex and the badge at the hex's centre, or its badge. */
export function pinFootprint(pin: Pick<NotePin, 'x' | 'y' | 'hex'>, grid: GridState | null): WorldBounds {
  if (pin.hex !== true || !grid || !isHexGridType(grid.type) || !(grid.size > 0)) return badgeAt(pin.x, pin.y);
  const layout = createHexLayout(grid.type, grid.size, grid.offsetX ?? 0, grid.offsetY ?? 0);
  const centre = axialToPixel(layout, pixelToAxial(layout, pin));
  const badge = badgeAt(centre.x, centre.y);
  const points = [...hexVertices(layout, centre), { x: badge.x, y: badge.y }, { x: badge.x + badge.width, y: badge.y + badge.height }];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}
