/**
 * Atlas's tokens as the player window shows them, lowest layer first: the art clipped
 * to its circle (a marker until it has loaded) and turned by the token's rotation, the
 * ring when the token has one, a grey veil and a skull when it is downed; then, above every token, their bars,
 * nameplates, wheels and condition badges. On this
 * player's view only (`frame.overlay`), the tokens they control get a highlight ring, and
 * a token they drag or just dropped is drawn where they put it. A token whose place
 * changes glides there as in Atlas (`tokenGlides.ts`); on a lit scene only the player's own do.
 */
import { DOWNED_LOOK } from '@atlas-vtt/shared/draw';
import { getTokenRingCenterRadius, getTokenRingOuterDiameter } from '@atlas-vtt/shared/draw';
import { computeTokenPixelSize, computeTokenStrokeWidth } from '@atlas-vtt/shared/draw';
import type { PlayerToken } from '../../scene/sceneTypes';
import { intersects } from '../camera';
import type { ViewSurface } from '../ViewSurface';
import type { LayerFrame, PlayerLayer } from './layerTypes';
import { TokenGlides } from './tokenGlides';
import { DARKNESS_FOG_ID } from '../../scene/darknessFog';
import { turnOf } from '../turns';
import { drawTokenUi } from './tokenUiDrawing';
import { BarFills } from './barFills';
import { BadgeEntrances } from './badgeEntrances';
import { prefersReducedMotion } from '../motion';

/** The stand-in drawn until a token's art has loaded. */
export const TOKEN_MARKER_COLOR = '#9aa0a6';
/** The veil over a downed token's art and ring (Atlas greys them) and its skull's colour. */
export const DOWNED_VEIL = { color: '#2b2b30', alpha: 0.55, skull: '#d6cebd' } as const;
/** Lucide's skull fills this much of its icon box. */
const SKULL_GLYPH_SHARE = 20 / 24;
/** The ring around the tokens this player controls. */
export const CONTROLLED_RING_COLOR = '#facc15';
/** The ring around the token whose turn it is in a fight in turn order, for every player. */
export const TURN_RING_COLOR = '#f8fafc';

export function createTokensLayer(options: { now?: () => number; reducedMotion?: () => boolean } = {}): PlayerLayer {
  // Sorted once per change of the tokens, not on every frame; ids kept for the overlay.
  let sorted: { tokens: Readonly<Record<string, PlayerToken>>; list: Array<[string, PlayerToken]> } | null = null;
  const byLayer = (tokens: Readonly<Record<string, PlayerToken>>): Array<[string, PlayerToken]> => {
    if (sorted === null || sorted.tokens !== tokens) sorted = { tokens, list: Object.entries(tokens).sort(([, a], [, b]) => a.layer - b.layer) };
    return sorted.list;
  };
  // Moves glide as Atlas's do, instead of jumping (a drop snapping to the grid, the GM moving a token).
  const now = options.now ?? (() => performance.now());
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  const glides = new TokenGlides(now, reducedMotion);
  // Bars ease to each new value as Atlas's do.
  const fills = new BarFills(now, reducedMotion);
  // New condition badges animate in as Atlas's do.
  const entrances = new BadgeEntrances(now, reducedMotion);
  return {
    draw(surface, frame): void {
      const cellSize = frame.scene.map.cellSize;
      const stroke = computeTokenStrokeWidth(cellSize);
      const { controlled, positions, held } = frame.overlay;
      glides.begin(frame.scene.sceneId);
      fills.begin(frame.scene.sceneId);
      entrances.begin(frame.scene.sceneId);
      const turnToken = turnOf(frame.scene, controlled).tokenId;
      // A lit scene's darkness reaches players as a fog operation of its own: there only their tokens glide.
      const lit = Object.hasOwn(frame.scene.fog, DARKNESS_FOG_ID);
      // Every token's bars, nameplate and badges go above all the tokens, as Atlas's token UI layer lies above them,
      // so a token on a higher layer never covers a neighbour's.
      const uis: Array<() => void> = [];
      for (const [id, inScene] of byLayer(frame.scene.tokens)) {
        const target = positions.get(id) ?? inScene;
        const at = glides.position(id, { x: target.x, y: target.y }, id === held, !lit || controlled.has(id));
        const token = at.x === inScene.x && at.y === inScene.y ? inScene : { ...inScene, x: at.x, y: at.y };
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
        // Whose turn it is, outside the player's own ring so both show.
        if (id === turnToken) surface.circle(token.x, token.y, ringRadius + stroke * 3, { stroke: TURN_RING_COLOR, lineWidth: stroke, alpha: 0.9 });
        entrances.seeToken(id);
        uis.push(() => drawTokenUi(surface, token, { size, cellSize, ringRadius }, (slot, share) => fills.frame(`${id}:${slot}`, share),
          (badge) => entrances.frame(id, badge)));
      }
      for (const ui of uis) ui();
      glides.end();
      fills.end();
      entrances.end();
    },
    animating: () => glides.animating() || fills.animating() || entrances.animating(),
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
  // Atlas's ring texture at Atlas's size (SpriteFactory.createTokenRing): the art plus a stroke's width on each side.
  if (token.ring !== null) surface.tokenRing(0, 0, getTokenRingOuterDiameter(size, stroke, 1), size, token.ring);
  surface.pop();
}

/** What Atlas's downed overlay does to the token: greyed art and ring, and the skull on top, upright. */
function drawDowned(surface: ViewSurface, token: PlayerToken, size: number, ringRadius: number, stroke: number): void {
  surface.circle(token.x, token.y, Math.max(size / 2, ringRadius + stroke / 2), { fill: DOWNED_VEIL.color, alpha: DOWNED_VEIL.alpha });
  surface.icon('skull', token.x, token.y, (size * DOWNED_LOOK.skullShare) / SKULL_GLYPH_SHARE, DOWNED_VEIL.skull, DOWNED_LOOK.markerOpacity);
}
