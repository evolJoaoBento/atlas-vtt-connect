/**
 * The resources of a token that have something to show, in their sockets, as Atlas 0.10.2 picks them (`S1`, `zA`, `hD`),
 * © Fabian Urbanek, AGPL-3.0-only. It replaces the shared `visibleResources`, which asks every value for a maximum
 * above 0 and so never shows a static value of 0 (an AC of 0): Atlas shows a static resource from a maximum of 0 up
 * (fixed in Atlas 0.8), any other from above 0.
 */
import type { ResourceDefinition, ResourceHolder, ResourceValue } from '@atlas-vtt/api-types';

/** Sockets a collection's resources sit in: two bars and four wheels. */
const MAX_RESOURCES = 6;

const isSocket = (slot: unknown): slot is number => typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot < MAX_RESOURCES;

/** Each resource in its socket: the one it names, else the first free; at most six, in socket order. */
function slottedResources(definitions: readonly ResourceDefinition[]): Array<{ definition: ResourceDefinition; slot: number }> {
  const sockets = new Map<number, ResourceDefinition>();
  const waiting: ResourceDefinition[] = [];
  for (const definition of definitions) {
    if (isSocket(definition.slot) && !sockets.has(definition.slot)) sockets.set(definition.slot, definition);
    else waiting.push(definition);
  }
  for (let slot = 0; slot < MAX_RESOURCES && waiting.length > 0; slot++) {
    if (!sockets.has(slot)) sockets.set(slot, waiting.shift() as ResourceDefinition);
  }
  return [...sockets].sort(([a], [b]) => a - b).map(([slot, definition]) => ({ definition, slot }));
}

/** Whether a value is one Atlas draws: a static resource from a maximum of 0 up (a plain 0 shows), any other from above 0. */
export function hasShownValue(definition: ResourceDefinition, value: ResourceValue): boolean {
  return definition.direction === 'static' ? value.max >= 0 : value.max > 0;
}

/** The token's resources with something to show, with their sockets; a player sees only those the collection shows players. */
export function visibleResources(token: ResourceHolder, definitions: readonly ResourceDefinition[], viewer: 'dm' | 'player'): Array<{ definition: ResourceDefinition; value: ResourceValue; slot: number }> {
  const shown: Array<{ definition: ResourceDefinition; value: ResourceValue; slot: number }> = [];
  for (const { definition, slot } of slottedResources(definitions)) {
    if (viewer === 'player' && !definition.visibleToPlayers) continue;
    const value = token.resources?.[definition.key];
    if (!value || !hasShownValue(definition, value)) continue;
    shown.push({ definition, value, slot });
  }
  return shown;
}
