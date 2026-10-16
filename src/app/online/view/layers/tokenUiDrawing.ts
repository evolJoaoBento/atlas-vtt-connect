/**
 * A token's resource bars, nameplate and condition badges, laid out by the modules
 * Atlas's `TokenUIRenderer` and `ConditionBadgeRing` use, at Atlas's resting token UI
 * size. The bars are what the player window shows: a track, a fill in the colour it
 * sends and no numbers; its wheels stand beside the token with theirs. Condition badges are Atlas's: a disc lit
 * from above in the condition's colour with its icon or initial, and its number in a pip.
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
import type { BadgeFrame } from './badgeEntrances';
import { drawWheels } from './tokenWheels';

/** Condition badges without their definitions: one neutral colour for all. */
export const NEUTRAL_BADGE_COLOR = '#5b5f6a';
export const NAMEPLATE_FONT = `${NAMEPLATE.fontWeight} ${NAMEPLATE.fontSize}px ${NAMEPLATE.fontFamily}`;
const BADGE_TEXT = '#ffffff';
/** Atlas's badge glyphs: their box as a share of the badge's diameter, the dark glyph on light colours, the digits' box in a pip, the font. */
const GLYPH_SHARE = 0.62;
const DARK_GLYPH_COLOR = '#16161a';
const PIP_DIGITS_SHARE = 0.78;
const BADGE_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

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

/** 0xRRGGBB darkened by `amount` of 255 on each channel, as Atlas's `darkenColor`. */
export function darkenColor(color: number, amount: number): number {
  const step = Math.round(255 * amount);
  const channel = (shift: number): number => Math.max(0, ((color >> shift) & 255) - step) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** `#rrggbb` as 0xRRGGBB; null for anything else. */
export function colorNumber(css: string): number | null {
  return /^#[0-9a-f]{6}$/i.test(css) ? parseInt(css.slice(1), 16) : null;
}

/** Where a token's bars are drawn this frame (their animation, `barFills.ts`); without it each shows its value. */
export type BarFrameOf = (slot: number, share: number) => BarFrame;

/** How far a token's badge is into its entrance this frame (`badgeEntrances.ts`); without it each is settled. */
export type BadgeFrameOf = (badge: string) => BadgeFrame;

export function drawTokenUi(surface: ViewSurface, token: PlayerToken, geometry: TokenUiGeometry, barFrame?: BarFrameOf, badgeFrame?: BadgeFrameOf): void {
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
  if (token.conditions.length > 0) drawBadges(surface, token, geometry.ringRadius, scale, badgeFrame ?? (() => ({ scale: 1, alpha: 1 })));
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

function drawBadges(surface: ViewSurface, token: PlayerToken, ringRadius: number, scale: number, badgeFrame: BadgeFrameOf): void {
  const { shown, overflow } = fitBadges(token.conditions, ringRadius, scale);
  const badges: Array<PlayerCondition | null> = overflow > 0 ? [...shown, null] : shown;
  const positions = badgePositions(badges.length, ringRadius, scale);
  badges.forEach((condition, index) => {
    const at = positions[index];
    if (!at) return;
    const look: BadgeLook = condition ? badgeLook(condition) : { color: cssColor(CONDITION_BADGE.overflowColor), glyph: { text: `+${overflow}` }, value: null };
    // Keyed as Atlas keys its badges: a new colour, glyph or number is a new badge, which animates in.
    const key = condition ? `${condition.id}|${look.color}|${look.glyph.icon ?? look.glyph.text ?? ''}|${condition.value ?? ''}` : `+${overflow}`;
    const entrance = badgeFrame(key);
    surface.push(token.x + at.x, token.y + at.y, 0, scale * entrance.scale);
    drawBadge(surface, look, entrance.alpha);
    surface.pop();
  });
}

/** What a badge shows: the condition's colour and glyph (its icon, else its name's initial) and its number. */
export interface BadgeLook {
  color: string;
  glyph: { icon?: string; text?: string };
  value: number | null;
}

export function badgeLook(condition: PlayerCondition): BadgeLook {
  const color = condition.color ?? NEUTRAL_BADGE_COLOR;
  const initial = Array.from((condition.name ?? '').trim())[0];
  // Atlas's `conditionGlyph`: the icon, else the initial; a condition an older GM sent unnamed shows only its colour.
  const glyph = condition.icon ? { icon: condition.icon } : initial ? { text: initial.toLocaleUpperCase() } : {};
  return { color, glyph, value: condition.value };
}

/** Whether a dark glyph reads better than a white one on `color` (Atlas's `isLightBadgeColor`). */
export function isLightBadgeColor(color: number): boolean {
  const channel = (shift: number): number => {
    const value = ((color >> shift) & 0xff) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0) > 0.45;
}

/**
 * Atlas's badge (`createConditionBadge`): a soft drop shadow, a dark bezel, a disc lit from above in the condition's
 * colour with a faint rim of light, its glyph, and its number in a pip.
 */
function drawBadge(surface: ViewSurface, look: BadgeLook, alpha: number): void {
  const { radius, bezelWidth, bezelColor, pipShare, pipOffset, pipColor } = CONDITION_BADGE;
  const base = colorNumber(look.color) ?? colorNumber(NEUTRAL_BADGE_COLOR)!;
  surface.circle(0, radius * 0.18, radius + bezelWidth + 0.5, { fill: '#000000', alpha: 0.3 * alpha });
  surface.circle(0, 0, radius + bezelWidth, { fill: cssColor(bezelColor), alpha });
  surface.circle(0, 0, radius, {
    alpha,
    gradient: {
      from: { x: 0, y: -radius }, to: { x: 0, y: radius },
      stops: [[0, cssColor(lightenColor(base, 0.18))], [0.55, cssColor(base)], [1, cssColor(darkenColor(base, 0.2))]],
    },
  });
  const rim = radius * 0.08;
  surface.circle(0, 0, radius - rim / 2, { stroke: '#ffffff', lineWidth: rim, alpha: 0.18 * alpha });
  const glyphColor = isLightBadgeColor(base) ? DARK_GLYPH_COLOR : BADGE_TEXT;
  const glyphSize = radius * 2 * GLYPH_SHARE;
  if (look.glyph.icon) surface.glyph(look.glyph.icon, 0, 0, glyphSize, glyphColor, alpha);
  else if (look.glyph.text) badgeText(surface, look.glyph.text, 0, 0, glyphSize, glyphColor, alpha);
  if (look.value === null) return;
  const pip = radius * pipShare;
  const at = radius * pipOffset;
  surface.circle(at, at, pip + bezelWidth * 0.75, { fill: cssColor(bezelColor), alpha });
  surface.circle(at, at, pip, { fill: cssColor(pipColor), alpha });
  badgeText(surface, String(look.value), at, at, pip * 2 * PIP_DIGITS_SHARE, BADGE_TEXT, alpha);
}

/** Text in a glyph's box `size` wide, as Atlas rasterises it: bold, 0.78 of the box, shrunk to fit longer counts. */
function badgeText(surface: ViewSurface, text: string, x: number, y: number, size: number, color: string, alpha: number): void {
  let fontSize = size * 0.78;
  const width = surface.measureText(text, `700 ${fontSize}px ${BADGE_FONT}`);
  if (width > size * 0.92) fontSize *= (size * 0.92) / width;
  surface.text(text, x, y, { font: `700 ${fontSize}px ${BADGE_FONT}`, color, align: 'center', alpha });
}
