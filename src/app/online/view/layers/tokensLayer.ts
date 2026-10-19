/**
 * Atlas's tokens as the player window shows them, lowest layer first: the art clipped
 * to its circle (a marker until it has loaded) and turned by the token's rotation, the
 * ring when the token has one, a grey veil and a skull when it is downed; then, above every token, their bars,
 * nameplates, wheels and condition badges. On this
 * player's view only (`frame.overlay`), the tokens they control get a highlight ring, and
 * a token they drag or just dropped is drawn where they put it. A token whose place
 * changes glides there as in Atlas (`tokenGlides.ts`); on a lit scene only the player's own do.
 */
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
import { DOWNED_MOTION, DownedFades } from './downedFades';
import { TokenEmphasis } from './tokenEmphasis';
import { restingTokenUIScale, selectedTokenUIScale } from '@atlas-vtt/shared/draw';
import type { MiniLayer } from '../minis/miniLayer';
import { prefersReducedMotion } from '../motion';

/** Without a mini layer (the web page) no mini is drawn, and three.js is never part of the page. */
const NO_MINIS: MiniLayer = { begin: () => undefined, add: () => undefined, draw: () => undefined, animating: () => false, dispose: () => undefined };

/** The stand-in drawn until a token's art has loaded. */
export const TOKEN_MARKER_COLOR = '#9aa0a6';
/** The ring around the tokens this player controls. */
export const CONTROLLED_RING_COLOR = '#facc15';
/** The ring around the token whose turn it is in a fight in turn order, for every player. */
export const TURN_RING_COLOR = '#f8fafc';

export function createTokensLayer(options: { now?: () => number; reducedMotion?: () => boolean; minis?: MiniLayer } = {}): PlayerLayer {
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
  // Going down and being healed fade as Atlas's do.
  const downedFades = new DownedFades(now, reducedMotion);
  // A selected token's UI grows, and its numbers show while it is hovered or selected, as on Atlas's scene.
  const emphasis = new TokenEmphasis(now, reducedMotion);
  // The 3D minis standing on tokens (the Tabletop extension's), over the art and under the bars and badges.
  const minis = options.minis ?? NO_MINIS;
  return {
    draw(surface, frame): void {
      const cellSize = frame.scene.map.cellSize;
      const stroke = computeTokenStrokeWidth(cellSize);
      const { controlled, positions, held, selected = null, hovered = null } = frame.overlay;
      const resting = restingTokenUIScale(cellSize);
      const selectedScale = selectedTokenUIScale(resting, frame.zoom || 1);
      glides.begin(frame.scene.sceneId);
      fills.begin(frame.scene.sceneId);
      entrances.begin(frame.scene.sceneId);
      downedFades.begin(frame.scene.sceneId);
      emphasis.begin(frame.scene.sceneId);
      minis.begin(frame);
      const turnToken = turnOf(frame.scene, controlled).tokenId;
      // A lit scene's darkness reaches players as a fog operation of its own: there only their tokens glide.
      const lit = Object.hasOwn(frame.scene.fog, DARKNESS_FOG_ID);
      // Every token's bars, nameplate and badges go above all the tokens, as Atlas's token UI layer lies above them,
      // so a token on a higher layer never covers a neighbour's.
      const uis: Array<() => void> = [];
      const raised: Array<() => void> = [];
      for (const [id, inScene] of byLayer(frame.scene.tokens)) {
        const target = positions.get(id) ?? inScene;
        const at = glides.position(id, { x: target.x, y: target.y }, id === held, !lit || controlled.has(id));
        const token = at.x === inScene.x && at.y === inScene.y ? inScene : { ...inScene, x: at.x, y: at.y };
        // Never 0 or negative: Atlas's formula gives nothing at half a cell or less.
        const size = Math.max(1, computeTokenPixelSize(cellSize, token.size));
        // The art, its rings, and the bars and badges around it.
        const reach = size / 2 + stroke + cellSize;
        if (!intersects({ x: token.x - reach, y: token.y - reach, width: reach * 2, height: reach * 2 }, frame.visible)) continue;
        // The map's ring size scales the ring, and the rings, badges and wheels placed on it (`TokenUIRenderer.ringRadius`).
        const ringScale = token.ringScale ?? 1;
        const ringRadius = getTokenRingCenterRadius(size * ringScale, stroke, ringScale);
        const downed = downedFades.progress(id, token.downed === true);
        drawArt(surface, frame, token, size, stroke, ringRadius, downed);
        if (token.mini) minis.add(id, token, token.x, token.y, size);
        if (controlled.has(id)) {
          surface.circle(token.x, token.y, ringRadius + stroke * 1.5, { stroke: CONTROLLED_RING_COLOR, lineWidth: stroke });
        }
        // Whose turn it is, outside the player's own ring so both show.
        if (id === turnToken) surface.circle(token.x, token.y, ringRadius + stroke * 3, { stroke: TURN_RING_COLOR, lineWidth: stroke, alpha: 0.9 });
        entrances.seeToken(id);
        // A held or dragged token's UI rests, as Atlas's does.
        const shown = emphasis.frame(id, id === selected && id !== held, id === selected || id === hovered);
        const ui = (): void => drawTokenUi(surface, token, { size, cellSize, ringRadius }, {
          barFrame: (slot, share) => fills.frame(`${id}:${slot}`, share),
          badgeFrame: (badge) => entrances.frame(id, badge),
          uiScale: resting + (selectedScale - resting) * shown.selected,
          numbers: shown.numbers,
          numbersAloneScale: selectedScale,
          dark: frame.dark ?? true,
        });
        // The selected token's UI is raised above its neighbours', as Atlas raises it.
        if (id === selected) raised.push(ui);
        else uis.push(ui);
      }
      minis.draw(surface, frame);
      for (const ui of [...uis, ...raised]) ui();
      glides.end();
      fills.end();
      entrances.end();
      downedFades.end();
      emphasis.end();
    },
    animating: () => glides.animating() || fills.animating() || entrances.animating() || downedFades.animating() || emphasis.animating() || minis.animating(),
    dispose: () => minis.dispose(),
  };
}

/** `downed`: how far the token is into Atlas's downed look, 0 alive to 1: its art and ring greyed over, and the skull. */
/**
 * The token as Atlas's `SpriteFactory` builds it. Framed: the art cover-fitted in a circle, under Atlas's glass dome and
 * ring. Unframed (no ring): the whole artwork, contain-fitted, with neither (`syncTokenArtwork`). Only the art turns with
 * the token's rotation; the dome and ring stay upright, as Atlas rotates the sprite alone.
 */
function drawArt(surface: ViewSurface, frame: LayerFrame, token: PlayerToken, size: number, stroke: number, _ringRadius: number, downed: number): void {
  const radius = size / 2;
  const art = frame.images(token.image);
  const framed = token.ring !== null;
  surface.push(token.x, token.y, (token.rotation * Math.PI) / 180, 1);
  if (art) {
    const fit = framed ? Math.max(size / art.width, size / art.height) : Math.min(size / art.width, size / art.height);
    const width = art.width * fit;
    const height = art.height * fit;
    const clip = framed ? { x: 0, y: 0, radius } : null;
    surface.image(art.image, -width / 2, -height / 2, width, height, clip);
    if (downed > 0) surface.image(art.image, -width / 2, -height / 2, width, height, clip, { lifeless: true, alpha: downed });
  } else {
    surface.circle(0, 0, radius, { fill: TOKEN_MARKER_COLOR });
  }
  surface.pop();
  if (token.ring !== null) {
    surface.glassDome(token.x, token.y, size);
    // Atlas's ring texture at Atlas's size (SpriteFactory.createTokenRing): the art plus a stroke's width on each side,
    // scaled by the map's ring size.
    const ringScale = token.ringScale ?? 1;
    const diameter = getTokenRingOuterDiameter(size * ringScale, stroke, ringScale);
    surface.tokenRing(token.x, token.y, diameter, size, token.ring);
    if (downed > 0) surface.tokenRing(token.x, token.y, diameter, size, token.ring, { lifeless: true, alpha: downed });
  }
  // The skull stays upright, spans the token and settles from a little larger as it fades in.
  if (downed > 0) {
    const scale = DOWNED_MOTION.emblemScale - (DOWNED_MOTION.emblemScale - 1) * downed;
    surface.downedEmblem(token.x, token.y, size * scale, downed * DOWNED_MOTION.emblemOpacity);
  }
  if (token.instance !== undefined) drawInstanceBadge(surface, token, size, stroke, token.instance);
}

/**
 * Atlas's instance badge (`updateInstanceBadge`): a black disc with a grey rim on the ring band, up and to the right,
 * with the number in white bold. Atlas places it on the ring as the token's own size draws it, whatever the ring size.
 */
function drawInstanceBadge(surface: ViewSurface, token: PlayerToken, size: number, stroke: number, number: number): void {
  const radius = Math.max(8, size * 0.14);
  const fontSize = Math.max(10, radius * 1.3);
  const ringRadius = getTokenRingCenterRadius(size, stroke, 1);
  const x = token.x + ringRadius * Math.SQRT1_2;
  const y = token.y - ringRadius * Math.SQRT1_2;
  surface.circle(x, y, radius, { fill: '#000000' });
  surface.circle(x, y, radius, { stroke: '#555555', lineWidth: 1.5 });
  surface.text(String(number), x, y, { font: `bold ${fontSize}px Arial, sans-serif`, color: '#ffffff', align: 'center' });
}
