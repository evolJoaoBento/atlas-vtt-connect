/**
 * The token resources online players receive: what the player window draws on a token, and no
 * more. `TokenUIRenderer` shows a player the resources its collection shows to players: the bars
 * (sockets 0 and 1) stacked in socket order, each as a fill in its colour, with its numbers, which
 * show on hover and selection as on Atlas's own scene, and the wheels (sockets 2 to 5) beside the
 * token, always shown, each with its number; the map's own `hiddenResources` do not apply to them.
 * Resources the collection keeps from players never go out, numbers or not.
 * A token whose resource that defeats it is spent is greyed with a skull whichever resources
 * players see. `visibleResources` stays the one place that picks the resources, so a rule the
 * window follows is followed here.
 */
import { isDefeated, isSpent, resourceColor, shapeOf, visibleResources } from '@atlas-vtt/shared/rules';
import type { ResourceDefinition, ResourceHolder, ResourceValue } from '@atlas-vtt/api-types';
import { finiteOr } from './coerce';
import { SCENE_RANGES } from './sceneLimits';
import type { PlayerResource, PlayerWheel } from './sceneTypes';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const NEUTRAL_COLOR = '#888888';
/** Shares go out in hundredths: a bar is a few dozen pixels wide, so a finer share shows nothing more. */
const SHARE_STEPS = 100;
/** The resource the player window's initiative list draws a bar for. */
const INITIATIVE_KEY = 'hp';

function shareOf(value: ResourceValue): number {
  const max = finiteOr(value.max, 0);
  if (!(max > 0)) return 0;
  const share = Math.max(0, Math.min(1, finiteOr(value.current, 0) / max));
  return Math.round(share * SHARE_STEPS) / SHARE_STEPS;
}

function hexOr(color: unknown): string {
  return typeof color === 'string' && HEX_COLOR.test(color) ? color : NEUTRAL_COLOR;
}

/** The bars the player window draws on `token`, top to bottom. */
export function projectBars(token: ResourceHolder, definitions: readonly ResourceDefinition[]): PlayerResource[] {
  let darkened = false;
  const bars: PlayerResource[] = [];
  for (const { definition, value, slot } of visibleResources(token, definitions, 'player')) {
    if (shapeOf(slot) !== 'bar') continue;
    const fixed = definition.direction === 'static';
    // The window darkens the first bar whose spending defeats the token, and only that one.
    const dark: boolean = !darkened && definition.defeatedWhenSpent === true && isSpent(definition, value);
    darkened ||= dark;
    bars.push({
      color: hexOr(resourceColor(definition, value)), share: fixed ? 1 : shareOf(value), spent: dark,
      // The numbers Atlas's scene shows on the bar on hover and selection: of resources the collection shows to players only.
      current: finiteOr(value.current, 0, SCENE_RANGES.resourceValue), max: finiteOr(value.max, 0, SCENE_RANGES.resourceValue),
      ...(fixed ? { fixed: true } : {}),
    });
  }
  return bars;
}

/**
 * The wheels the player window draws beside `token`, in socket order: the resources players see in sockets 2 to 5,
 * each with its numbers, which the window shows in the wheel's middle (`ResourceWheelView`), its wheels at rest.
 */
export function projectWheels(token: ResourceHolder, definitions: readonly ResourceDefinition[]): PlayerWheel[] {
  const wheels: PlayerWheel[] = [];
  for (const { definition, value, slot } of visibleResources(token, definitions, 'player')) {
    if (shapeOf(slot) !== 'wheel') continue;
    wheels.push({
      slot: finiteOr(slot, 2, SCENE_RANGES.wheelSlot),
      color: hexOr(resourceColor(definition, value)),
      current: finiteOr(value.current, 0, SCENE_RANGES.resourceValue),
      max: finiteOr(value.max, 0, SCENE_RANGES.resourceValue),
      fixed: definition.direction === 'static',
    });
  }
  return wheels;
}

/** Whether the window greys the token out: a resource that defeats it is spent, one players see or not. */
export function isDowned(token: ResourceHolder & { kind?: unknown }, definitions: readonly ResourceDefinition[]): boolean {
  return token.kind === 'character' && isDefeated(token, definitions);
}

/**
 * How full the bar of the player window's initiative list is: the token's `hp` resource, where the
 * collection shows `hp` to players, whatever socket it takes. Null when the list draws no bar.
 */
export function initiativeShare(token: ResourceHolder | undefined, definitions: readonly ResourceDefinition[]): number | null {
  const shown = definitions.some((definition) => definition.key === INITIATIVE_KEY && definition.visibleToPlayers);
  const value = token?.resources?.[INITIATIVE_KEY];
  if (!shown || !value || !(finiteOr(value.max, 0) > 0)) return null;
  return shareOf(value);
}
