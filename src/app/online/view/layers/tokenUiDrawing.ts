/**
 * A token's resource bars, nameplate and condition badges, laid out by the modules
 * Atlas's `TokenUIRenderer` and `ConditionBadgeRing` use, at Atlas's resting token UI
 * size. The bars are what the player window shows: a track, a fill in the colour it
 * sends and no numbers. Players receive condition ids and values only, so badges are
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
import type { PlayerCondition, PlayerResource, PlayerToken } from '../../scene/sceneTypes';
import type { ViewSurface } from '../ViewSurface';

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

export function drawTokenUi(surface: ViewSurface, token: PlayerToken, geometry: TokenUiGeometry): void {
  const scale = restingTokenUIScale(geometry.cellSize);
  // The window draws the first sockets as bars; a token's others (wheels) never reach players' view.
  const bars = (token.resources ?? []).slice(0, BAR_SLOTS);
  if (bars.length > 0 || token.name) {
    // Anchored on the token's bottom edge, in UI units, like Atlas's `belowToken` container.
    surface.push(token.x, token.y + geometry.size / 2, 0, scale);
    if (token.name) drawNameplate(surface, token.name);
    drawBars(surface, bars);
    surface.pop();
  }
  if (token.conditions.length > 0) drawBadges(surface, token, geometry.ringRadius, scale);
}

function drawBars(surface: ViewSurface, bars: readonly PlayerResource[]): void {
  const rects = barStackRects(bars.length);
  bars.forEach((bar, index) => {
    const rect = rects[index];
    if (!rect) return;
    drawBar(surface, rect, bar.share, bar.color);
    // The window darkens the bar whose spending defeats the token.
    if (bar.spent) {
      surface.roundRect(rect.x, rect.y, rect.width, rect.height, barDimensions.token.radius, { fill: '#000000', alpha: BAR_STYLE.defeatedAlpha });
    }
  });
}

function drawBar(surface: ViewSurface, bar: UiRect, filled: number, color: string): void {
  surface.roundRect(bar.x, bar.y, bar.width, bar.height, bar.height / 2, { stroke: cssColor(BAR_STYLE.border), lineWidth: BAR_BORDER });
  const inner = barInnerRect(bar);
  surface.roundRect(inner.x, inner.y, inner.width, inner.height, inner.height / 2, { fill: cssColor(BAR_STYLE.inside) });
  const ticks = barTickXs(inner).map((x) => [{ x, y: inner.y + 1 }, { x, y: inner.y + inner.height - 1 }]);
  surface.paths(ticks, false, { stroke: cssColor(BAR_STYLE.tick), lineWidth: BAR_STYLE.tickWidth, alpha: BAR_STYLE.tickAlpha });
  const fill = barFillRect(inner);
  if (filled > 0) surface.roundRect(fill.x, fill.y, fill.width * filled, fill.height, fill.height / 2, { fill: color });
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
