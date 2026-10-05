/**
 * Atlas's tokens as the player window shows them, lowest layer first: the art clipped
 * to its circle (a marker until it has loaded) and turned by the token's rotation, the
 * ring when the token has one, a grey veil and a skull when it is downed, then its bars, nameplate and condition badges. On this
 * player's view only (`frame.overlay`), the tokens they control get a highlight ring, and
 * a token they drag or just dropped is drawn where they put it.
 */
import { DOWNED_LOOK } from '@atlas-vtt/shared/draw';
import { getTokenRingCenterRadius } from '@atlas-vtt/shared/draw';
import { computeTokenPixelSize, computeTokenStrokeWidth } from '@atlas-vtt/shared/draw';
import type { PlayerToken } from '../../scene/sceneTypes';
import { intersects } from '../camera';
import type { ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';
import { drawTokenUi } from './tokenUiDrawing';

/** The stand-in drawn until a token's art has loaded. */
export const TOKEN_MARKER_COLOR = '#9aa0a6';
/** The veil over a downed token's art and ring (Atlas greys them) and its skull's colour. */
export const DOWNED_VEIL = { color: '#2b2b30', alpha: 0.55, skull: '#d6cebd' } as const;
/** Lucide's skull fills this much of its icon box. */
const SKULL_GLYPH_SHARE = 20 / 24;
/** The ring around the tokens this player controls. */
export const CONTROLLED_RING_COLOR = '#facc15';

export function createTokensLayer(): PlayerLayer {
  // Sorted once per change of the tokens, not on every frame; ids kept for the overlay.
  let sorted: { tokens: Readonly<Record<string, PlayerToken>>; list: Array<[string, PlayerToken]> } | null = null;
  const byLayer = (tokens: Readonly<Record<string, PlayerToken>>): Array<[string, PlayerToken]> => {
    if (sorted === null || sorted.tokens !== tokens) sorted = { tokens, list: Object.entries(tokens).sort(([, a], [, b]) => a.layer - b.layer) };
    return sorted.list;
  };
  return {
    draw(surface, frame): void {
      const cellSize = frame.scene.map.cellSize;
      const stroke = computeTokenStrokeWidth(cellSize);
      const { controlled, positions } = frame.overlay;
      for (const [id, inScene] of byLayer(frame.scene.tokens)) {
        const at = positions.get(id);
        const token = at ? { ...inScene, x: at.x, y: at.y } : inScene;
        // Never 0 or negative: Atlas's formula gives nothing at half a cell or less.
        const size = Math.max(1, computeTokenPixelSize(cellSize, token.size));
        // The art, its rings, and the bars and badges around it.
        const reach = size / 2 + stroke + cellSize;
        if (!intersects({ x: token.x - reach, y: token.y - reach, width: reach * 2, height: reach * 2 }, frame.visible)) continue;
        const ringRadius = getTokenRingCenterRadius(size, stroke, 1);
        drawArt(surface, frame, token, size, stroke, ringRadius);
        if (token.downed === true) drawDowned(surface, token, size, ringRadius, stroke);
        if (controlled.has(id)) {
          surface.circle(token.x, token.y, ringRadius + stroke * 1.5, { stroke: CONTROLLED_RING_COLOR, lineWidth: stroke });
        }
        drawTokenUi(surface, token, { size, cellSize, ringRadius });
      }
    },
  };
}

function drawArt(surface: ViewSurface, frame: LayerFrame, token: PlayerToken, size: number, stroke: number, ringRadius: number): void {
  const radius = size / 2;
  const art = frame.images(token.image);
  surface.push(token.x, token.y, (token.rotation * Math.PI) / 180, 1);
  if (art) {
    // Cover-fit: the art fills the circle and keeps its proportions.
    const scale = Math.max(size / art.width, size / art.height);
    const width = art.width * scale;
    const height = art.height * scale;
    surface.image(art.image, -width / 2, -height / 2, width, height, { x: 0, y: 0, radius });
  } else {
    surface.circle(0, 0, radius, { fill: TOKEN_MARKER_COLOR });
  }
  if (token.ring !== null) surface.circle(0, 0, ringRadius, { stroke: token.ring, lineWidth: stroke });
  surface.pop();
}

/** What Atlas's downed overlay does to the token: greyed art and ring, and the skull on top, upright. */
function drawDowned(surface: ViewSurface, token: PlayerToken, size: number, ringRadius: number, stroke: number): void {
  surface.circle(token.x, token.y, Math.max(size / 2, ringRadius + stroke / 2), { fill: DOWNED_VEIL.color, alpha: DOWNED_VEIL.alpha });
  surface.icon('skull', token.x, token.y, (size * DOWNED_LOOK.skullShare) / SKULL_GLYPH_SHARE, DOWNED_VEIL.skull, DOWNED_LOOK.markerOpacity);
}
