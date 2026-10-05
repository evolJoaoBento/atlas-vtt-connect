/**
 * The GM's tokens as Atlas records, field by field: only what `PlayerToken` names, so a field
 * the network adds never reaches the store. Received maps (`sharing/receive/receivedMap.ts`) use
 * them; the remote view (B15) adds the neutral condition definitions here.
 */
import type { BaseToken, Character, Token, TokenEntity } from '@atlas-vtt/api-types';
import { setOwn } from '../scene/sceneDiff';
import { atlasBars } from './convertResources';
import type { PlayerCondition, PlayerToken, ScenePoint } from '../scene/sceneTypes';

function conditionFields(conditions: readonly PlayerCondition[]): Partial<Pick<BaseToken, 'conditions' | 'conditionValues'>> {
  if (conditions.length === 0) return {};
  const values: Record<string, number> = {};
  for (const condition of conditions) if (condition.value !== null) setOwn(values, condition.id, condition.value);
  return {
    conditions: conditions.map((condition) => condition.id),
    ...(Object.keys(values).length > 0 ? { conditionValues: values } : {}),
  };
}

/**
 * An Atlas token for one the GM sent. `imagePath` is the art's path or URL, '' while it has none
 * (Atlas then draws its default token). `position` replaces the GM's while a view shows the
 * token elsewhere: a drag, or a drop the GM has not answered.
 */
export function atlasToken(id: string, token: PlayerToken, imagePath: string, position: ScenePoint | null = null): TokenEntity {
  const base = {
    id,
    x: position?.x ?? token.x,
    y: position?.y ?? token.y,
    size: token.size,
    rotation: token.rotation,
    layer: token.layer,
    imagePath,
    showRing: token.ring !== null,
    ...(token.ring !== null ? { ringColor: token.ring } : {}),
    ...conditionFields(token.conditions),
    // Where the list by sides files the combatant (`sideOf`); sent only for combatants while the list is by sides
    ...(token.side && { side: token.side }),
  };
  const bars = atlasBars(token);
  if (token.name === null && bars === null) {
    const plain: Token = { ...base, kind: 'token' };
    return plain;
  }
  const character: Character = {
    ...base,
    kind: 'character',
    name: token.name ?? '',
    // The map's nameplate setting stays off: a plate shows only where the GM sent a name.
    ...(token.name !== null ? { showNameplate: true } : {}),
    // The bars and the downed state, which `viewResourceDefinitions` draws from the scene's stand-in definitions
    ...(bars ? { resources: bars.values } : {}),
  };
  return character;
}
