/**
 * A token's resource bars, nameplate and condition badges, laid out by the modules
 * Atlas's `TokenUIRenderer` and `ConditionBadgeRing` use, at Atlas's resting token UI
 * size. The bars are what the player window shows: a track, a fill in the colour it
 * sends and no numbers; its wheels stand beside the token with theirs. Players receive condition ids and values only, so badges are
 * neutral discs with the value in a pip.
 */
import { badgePositions, CONDITION_BADGE, fitBadges } from '@atlas-vtt/shared/draw';
import { restingTokenUIScale } from '@atlas-vtt/shared/draw';
import { BAR_SLOTS } from '@atlas-vtt/shared/rules';
import {
  BAR_BORDER, BAR_STYLE, barFillRect, barInnerRect, barStackRects, barTickXs, NAMEPLATE, NAMEPLATE_STYLE, nameplateRect,
  type UiRect,
} from '@atlas-vtt/shared/draw';
import { barDimensions } from '@atlas-vtt/shared/draw';
import type { PlayerCondition, PlayerResource, PlayerToken, ScenePoint } from '../../scene/sceneTypes';
import type { ShapeStyle, ViewSurface } from '../ViewSurface';
import { BAR_MOTION, type BarFrame } from './barFills';
import { drawWheels } from './tokenWheels';

/** Condition badges without their definitions: one neutral colour for all. */
export const NEUTRAL_BADGE_COLOR = '#5b5f6a';
export const NAMEPLATE_FONT = `${NAMEPLATE.fontWeight} ${NAMEPLATE.fontSize}px ${NAMEPLATE.fontFamily}`;
const BADGE_TEXT = '#ffffff';

/** 0xRRGGBB as a CSS colour. */
export function cssColor(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export interface TokenUiGeometry {
  /** The token's sprite size in world units. */
  size: number;
  cellSize: number;
  /** The centre of the ring band, from the token's centre. */
  ringRadius: number;
}

/** 0xRRGGBB brightened by `amount` of 255 on each channel, as Atlas's `lightenColor`. */
export function lightenColor(color: number, amount: number): number {
  const step = Math.round(255 * amount);
  const channel = (shift: number): number => Math.min(255, ((color >> shift) & 255) + step) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** `#rrggbb` as 0xRRGGBB; null for anything else. */
export function colorNumber(css: string): number | null {
  return /^#[0-9a-f]{6}$/i.test(css) ? parseInt(css.slice(1), 16) : null;
}

/** Where a token's bars are drawn this frame (their animation, `barFills.ts`); without it each shows its value. */
export type BarFrameOf = (slot: number, share: number) => BarFrame;

export function drawTokenUi(surface: ViewSurface, token: PlayerToken, geometry: TokenUiGeometry, barFrame?: BarFrameOf): void {
  const scale = restingTokenUIScale(geometry.cellSize);
  // The window draws the first two sockets as bars, and the others as wheels beside the token (`tokenWheels.ts`).
  const bars = (token.resources ?? []).slice(0, BAR_SLOTS);
  if (bars.length > 0 || token.name) {
    // Anchored on the token's bottom edge, in UI units, like Atlas's `belowToken` container.
    surface.push(token.x, token.y + geometry.size / 2, 0, scale);
    if (token.name) drawNameplate(surface, token.name);
    drawBars(surface, bars, barFrame ?? ((_slot, share) => ({ fill: share, trail: share })));
    surface.pop();
  }
  drawWheels(surface, token, token.wheels ?? [], geometry.size, geometry.ringRadius, geometry.cellSize);
  if (token.conditions.length > 0) drawBadges(surface, token, geometry.ringRadius, scale);
}

function drawBars(surface: ViewSurface, bars: readonly PlayerResource[], barFrame: BarFrameOf): void {
  const rects = barStackRects(bars.length);
  bars.forEach((bar, index) => {
    const rect = rects[index];
    if (!rect) return;
    drawBar(surface, rect, barFrame(index, bar.share), bar.color);
    // The window darkens the bar whose spending defeats the token.
    if (bar.spent) {
      surface.roundRect(rect.x, rect.y, rect.width, rect.height, barDimensions.token.radius, { fill: '#000000', alpha: BAR_STYLE.defeatedAlpha });
    }
  });
}

function drawBar(surface: ViewSurface, bar: UiRect, shown: BarFrame, color: string): void {
  surface.roundRect(bar.x, bar.y, bar.width, bar.height, bar.height / 2, { stroke: cssColor(BAR_STYLE.border), lineWidth: BAR_BORDER });
  const inner = barInnerRect(bar);
  surface.roundRect(inner.x, inner.y, inner.width, inner.height, inner.height / 2, { fill: cssColor(BAR_STYLE.inside) });
  const ticks = barTickXs(inner).map((x) => [{ x, y: inner.y + 1 }, { x, y: inner.y + inner.height - 1 }]);
  surface.paths(ticks, false, { stroke: cssColor(BAR_STYLE.tick), lineWidth: BAR_STYLE.tickWidth, alpha: BAR_STYLE.tickAlpha });
  const fill = barFillRect(inner);
  // A loss's pale trail, behind the fill (`AnimatedBarFill`).
  const base = colorNumber(color);
  if (shown.trail > shown.fill && base !== null) {
    drawBarFill(surface, fill.x, fill.y, fill.width * shown.trail, fill.height,
      { fill: cssColor(lightenColor(base, BAR_MOTION.trailLighten)), alpha: BAR_MOTION.trailAlpha });
  }
  if (shown.fill > 0) drawBarFill(surface, fill.x, fill.y, fill.width * shown.fill, fill.height, { fill: color });
}

/** Points along a narrow fill's arc: enough that its curve stays smooth at any zoom. */
const CAP_STEPS = 12;

/**
 * A fill `width` long, its ends rounded as the bar's (Atlas's `resourceBarFill`). Narrower than the bar is tall, only
 * the filled part of the round cap is drawn: a rounded rectangle would shrink its radius and become a thin strip.
 */
export function drawBarFill(surface: ViewSurface, x: number, y: number, width: number, height: number, style: ShapeStyle): void {
  if (width <= 0 || height <= 0) return;
  const radius = height / 2;
  if (width >= height) {
    surface.roundRect(x, y, width, height, radius, style);
    return;
  }
  // The cap's circle, cut by the vertical line at the fill's end: its left part, from the chord's top round to its bottom.
  const angle = Math.acos((width - radius) / radius);
  const centerX = x + radius;
  const centerY = y + radius;
  const points: ScenePoint[] = [];
  for (let step = 0; step <= CAP_STEPS; step++) {
    const theta = angle + ((2 * Math.PI - 2 * angle) * step) / CAP_STEPS;
    points.push({ x: centerX + radius * Math.cos(theta), y: centerY + radius * Math.sin(theta) });
  }
  surface.paths([points], true, style);
}

/** Nameplate widths by name, measured once, since the font never changes; emptied when it grows past this. */
const MAX_MEASURED_NAMES = 2000;
const nameWidths = new Map<string, number>();

function nameWidth(surface: ViewSurface, name: string): number {
  let width = nameWidths.get(name);
  if (width === undefined) {
    if (nameWidths.size >= MAX_MEASURED_NAMES) nameWidths.clear();
    width = surface.measureText(name, NAMEPLATE_FONT);
    nameWidths.set(name, width);
  }
  return width;
}

function drawNameplate(surface: ViewSurface, name: string): void {
  const badge = nameplateRect(nameWidth(surface, name));
  const plate = NAMEPLATE_STYLE.dark;
  surface.roundRect(badge.x, badge.y, badge.width, badge.height, badge.height / 2, { fill: cssColor(plate.fill) });
  surface.roundRect(badge.x, badge.y, badge.width, badge.height, badge.height / 2,
    { stroke: cssColor(plate.border), lineWidth: NAMEPLATE_STYLE.borderWidth, alpha: plate.borderAlpha });
  surface.push(0, badge.textY, 0, NAMEPLATE.textScale);
  surface.text(name, 0, 0, { font: NAMEPLATE_FONT, color: cssColor(NAMEPLATE_STYLE.text), align: 'center', alpha: NAMEPLATE.textAlpha });
  surface.pop();
}

function drawBadges(surface: ViewSurface, token: PlayerToken, ringRadius: number, scale: number): void {
  const { shown, overflow } = fitBadges(token.conditions, ringRadius, scale);
  const badges: Array<PlayerCondition | null> = overflow > 0 ? [...shown, null] : shown;
  const positions = badgePositions(badges.length, ringRadius, scale);
  badges.forEach((condition, index) => {
    const at = positions[index];
    if (!at) return;
    surface.push(token.x + at.x, token.y + at.y, 0, scale);
    if (condition) drawBadge(surface, NEUTRAL_BADGE_COLOR, null, condition.value);
    else drawBadge(surface, cssColor(CONDITION_BADGE.overflowColor), `+${overflow}`, null);
    surface.pop();
  });
}

function drawBadge(surface: ViewSurface, color: string, label: string | null, value: number | null): void {
  const { radius, bezelWidth, bezelColor, pipShare, pipOffset, pipColor } = CONDITION_BADGE;
  surface.circle(0, 0, radius + bezelWidth, { fill: cssColor(bezelColor) });
  surface.circle(0, 0, radius, { fill: color });
  if (label !== null) surface.text(label, 0, 0, { font: `bold ${radius}px system-ui, sans-serif`, color: BADGE_TEXT, align: 'center' });
  if (value === null) return;
  const pip = radius * pipShare;
  const at = radius * pipOffset;
  surface.circle(at, at, pip + bezelWidth * 0.75, { fill: cssColor(bezelColor) });
  surface.circle(at, at, pip, { fill: cssColor(pipColor) });
  surface.text(String(value), at, at, { font: `bold ${pip * 1.4}px system-ui, sans-serif`, color: BADGE_TEXT, align: 'center' });
}
