/**
 * Token resources as Atlas's own token UI draws them in the online scene. Players receive bars
 * (a colour, a share and whether the bar is darkened), never definitions or numbers, so each
 * token gets stand-in definitions of its own: one per bar, in the colour the GM's window shows
 * it in, filled to the share (current out of `SHARE_SCALE`). Atlas's `ResourceBarView` then draws
 * exactly what the window does. Every token with stand-ins also carries a `downed` one, which the
 * remote store hides from the token UI (`hiddenResources`): Atlas greys the token and marks it with a
 * skull while it is spent, as in the window, and eases back when it is not.
 *
 * Received maps (`sharing/receive/receivedMap.ts`) use the token values; the remote view also takes the
 * per-token definitions and the initiative health.
 */
import type { ResourceDefinition, ResourceValue } from '@atlas-vtt/api-types';
import { BAR_SLOTS } from '@atlas-vtt/shared/rules';
import { setOwn } from '../scene/sceneDiff';
import type { PlayerInitiative, PlayerResource, PlayerToken } from '../scene/sceneTypes';

/** A bar's share, as the stand-in value's `current` out of this. */
export const SHARE_SCALE = 100;
const BAR_KEY = 'bar';
export const DOWNED_KEY = 'downed';
const DOWNED_COLOR = '#ef4444';

export interface AtlasBars {
  /** The token's `resources`. */
  values: Record<string, ResourceValue>;
  /** The definitions those values are drawn by, in socket order. */
  definitions: ResourceDefinition[];
}

function barDefinition(bar: PlayerResource, slot: number): ResourceDefinition {
  // A spent bar is a draining one at 0 or a filling one at its maximum; Atlas darkens it, and its colour is the warning red
  const fills = bar.spent && bar.share >= 1;
  return {
    key: `${BAR_KEY}${slot}`, name: 'Resource', field: '', direction: fills ? 'fills' : 'drains', color: bar.color,
    visibleToPlayers: true, slot, ...(bar.spent ? { defeatedWhenSpent: true } : {}),
  };
}

function barValue(bar: PlayerResource): ResourceValue {
  const current = bar.spent && bar.share < 1 ? 0 : Math.round(bar.share * SHARE_SCALE);
  return { current, max: SHARE_SCALE };
}

/** The stand-ins of a token's bars and downed state; null when it has neither. */
export function atlasBars(token: PlayerToken): AtlasBars | null {
  // The window draws two bars for players, so the stand-ins never reach a wheel socket
  const bars = (token.resources ?? []).slice(0, BAR_SLOTS);
  if (bars.length === 0 && token.downed !== true) return null;
  const values: Record<string, ResourceValue> = {};
  const definitions = bars.map((bar, slot) => {
    const definition = barDefinition(bar, slot);
    values[definition.key] = barValue(bar);
    return definition;
  });
  // In no socket of its own and listed in `hiddenResources`: only `isDefeated` reads it. At 1 out of 1 it is
  // not spent, so a token that is healed has it too and Atlas eases the grey out
  definitions.push({
    key: DOWNED_KEY, name: 'Downed', field: '', direction: 'drains', color: DOWNED_COLOR, defeatedWhenSpent: true, visibleToPlayers: false,
  });
  values[DOWNED_KEY] = { current: token.downed === true ? 0 : 1, max: 1 };
  return { values, definitions };
}

/** The stand-in definitions of every token that has any, by token id (the remote view's `tokenUi.resources`). */
export function atlasResourceDefinitions(tokens: Readonly<Record<string, PlayerToken>>): Record<string, readonly ResourceDefinition[]> {
  const byToken: Record<string, readonly ResourceDefinition[]> = {};
  for (const [id, token] of Object.entries(tokens)) {
    const bars = atlasBars(token);
    if (bars) setOwn(byToken, id, bars.definitions);
  }
  return byToken;
}

/** The bar after each combatant's name in the initiative list, by token id: the share out of `SHARE_SCALE`. */
export function atlasInitiativeHealth(initiative: PlayerInitiative | null): Record<string, { value: number; max: number }> {
  const health: Record<string, { value: number; max: number }> = {};
  for (const entry of initiative?.entries ?? []) {
    if (typeof entry.hpShare === 'number') setOwn(health, entry.tokenId, { value: Math.round(entry.hpShare * SHARE_SCALE), max: SHARE_SCALE });
  }
  return health;
}
