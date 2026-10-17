/**
 * The token resources online players receive: what the player window draws on a token, and no
 * more. `TokenUIRenderer` shows a player the resources its collection shows to players: the bars
 * (sockets 0 and 1) stacked in socket order, each as a fill in its colour, with its numbers, which
 * show on hover and selection as on Atlas's own scene, and the wheels (sockets 2 to 5) beside the
 * token, always shown, each with its number; the map's own `hiddenResources` do not apply to them.
 * Resources the collection keeps from players never go out, numbers or not.
 * The GM may choose otherwise per token or statblock (`resourceVisibility.ts`): each resource is then shown with its
 * numbers, as a bar or wheel alone (its numbers never go out), as its numbers alone, or not at all.
 * A token whose resource that defeats it is spent is greyed with a skull whichever resources
 * players see. `visibleResources` stays the one place that picks the resources and their sockets, so a rule the
 * window follows is followed here.
 */
import { isDefeated, isSpent, resourceColor, shapeOf, visibleResources } from '@atlas-vtt/shared/rules';
import type { ResourceDefinition, ResourceHolder, ResourceValue } from '@atlas-vtt/api-types';
import { finiteOr } from './coerce';
import { collectionShow, type ResourceShow } from './resourceVisibility';
import { SCENE_RANGES } from './sceneLimits';
import type { PlayerResource, PlayerWheel } from './sceneTypes';

/** How each resource of one token is shown; without one, as its collection shows it. */
export type ShowOf = (definition: ResourceDefinition) => ResourceShow;

/** The token's resources with a value, in their sockets, that players see something of, with how. */
function shownResources(token: ResourceHolder, definitions: readonly ResourceDefinition[], showOf: ShowOf) {
  // The GM's view lists every slotted resource with a value; which of them go out is the show's to say.
  return visibleResources(token, definitions, 'dm')
    .map((entry) => ({ ...entry, show: showOf(entry.definition) }))
    .filter((entry) => entry.show !== 'hidden');
}

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

/**
 * The numbers that go out with a resource: both with its bar or wheel, none with the bar or wheel alone, and, shown
 * alone, only the one a player reads: the current value, or a static resource's value (its maximum).
 */
function numbersOf(show: ResourceShow, fixed: boolean, value: ResourceValue): { current?: number; max?: number } {
  const current = finiteOr(value.current, 0, SCENE_RANGES.resourceValue);
  const max = finiteOr(value.max, 0, SCENE_RANGES.resourceValue);
  if (show === 'bar') return {};
  if (show === 'numbers') return fixed ? { max } : { current };
  return { current, max };
}

/** The colour a resource goes out in: the one the window shows, or its own where only its number is shown (a warning colour tells how full it is). */
function colorOf(show: ResourceShow, definition: ResourceDefinition, value: ResourceValue): string {
  return hexOr(show === 'numbers' ? definition.color : resourceColor(definition, value));
}

/** The bars the player window draws on `token`, top to bottom. */
export function projectBars(token: ResourceHolder, definitions: readonly ResourceDefinition[], showOf: ShowOf = collectionShow): PlayerResource[] {
  let darkened = false;
  const bars: PlayerResource[] = [];
  for (const { definition, value, slot, show } of shownResources(token, definitions, showOf)) {
    if (shapeOf(slot) !== 'bar') continue;
    const fixed = definition.direction === 'static';
    // The window darkens the first bar whose spending defeats the token, and only that one.
    const dark: boolean = !darkened && definition.defeatedWhenSpent === true && isSpent(definition, value);
    darkened ||= dark;
    bars.push({
      // A number shown alone gives away nothing of its maximum: no share, no warning colour, no spent mark.
      color: colorOf(show, definition, value), share: fixed || show === 'numbers' ? 1 : shareOf(value), spent: dark && show !== 'numbers',
      // The numbers Atlas's scene shows on the bar on hover and selection; a bar shown alone never carries them.
      ...numbersOf(show, fixed, value),
      ...(fixed ? { fixed: true } : {}),
      ...(show === 'numbers' ? { bar: false as const } : {}),
    });
  }
  return bars;
}

/**
 * The wheels the player window draws beside `token`, in socket order: the resources players see in sockets 2 to 5,
 * each with its numbers, which the window shows in the wheel's middle (`ResourceWheelView`), its wheels at rest.
 */
export function projectWheels(token: ResourceHolder, definitions: readonly ResourceDefinition[], showOf: ShowOf = collectionShow): PlayerWheel[] {
  const wheels: PlayerWheel[] = [];
  for (const { definition, value, slot, show } of shownResources(token, definitions, showOf)) {
    if (shapeOf(slot) !== 'wheel') continue;
    const fixed = definition.direction === 'static';
    wheels.push({
      slot: finiteOr(slot, 2, SCENE_RANGES.wheelSlot),
      color: colorOf(show, definition, value),
      // A wheel shown alone carries how full it is, never its numbers (nor its segments, which would tell its maximum).
      ...(show === 'bar' ? { share: fixed ? 1 : shareOf(value) } : numbersOf(show, fixed, value)),
      fixed,
      ...(show === 'numbers' ? { ring: false as const } : {}),
    });
  }
  return wheels;
}

/** Whether the window greys the token out: a resource that defeats it is spent, one players see or not. */
export function isDowned(token: ResourceHolder & { kind?: unknown }, definitions: readonly ResourceDefinition[]): boolean {
  return token.kind === 'character' && isDefeated(token, definitions);
}

/**
 * How full the bar of the player window's initiative list is: the token's `hp` resource, where players
 * see its bar (the collection shows `hp` to players, or the GM's choice for the token shows a bar), whatever
 * socket it takes. Null when the list draws no bar.
 */
export function initiativeShare(token: ResourceHolder | undefined, definitions: readonly ResourceDefinition[], showOf: ShowOf = collectionShow): number | null {
  const definition = definitions.find((candidate) => candidate.key === INITIATIVE_KEY);
  const show = definition ? showOf(definition) : 'hidden';
  const value = token?.resources?.[INITIATIVE_KEY];
  if ((show !== 'both' && show !== 'bar') || !value || !(finiteOr(value.max, 0) > 0)) return null;
  return shareOf(value);
}
