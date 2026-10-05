/**
 * The GM's tokens as Atlas records, field by field: only what `PlayerToken` names, so a field
 * the network adds never reaches the store. Received maps (`sharing/receive/receivedMap.ts`) and the
 * remote view use them. Condition badges get neutral definitions, as on the join page: players never
 * receive the GM's.
 */
import type { BaseToken, Character, ConditionDefinition, Token, TokenEntity } from '@atlas-vtt/api-types';
import { setOwn } from '../scene/sceneDiff';
import { atlasBars } from './convertResources';
import type { PlayerCondition, PlayerToken, ScenePoint } from '../scene/sceneTypes';
import { NEUTRAL_BADGE_COLOR } from '../view/layers/tokenUiDrawing';

/** The name of every condition players see: they receive ids and values only. */
export const REMOTE_CONDITION_NAME = 'Condition';

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

/** A neutral definition for each condition id the tokens show, valued where any token sent a value. */
export function neutralConditions(tokens: Readonly<Record<string, PlayerToken>>): ConditionDefinition[] {
  const valued = new Map<string, boolean>();
  for (const token of Object.values(tokens)) {
    for (const condition of token.conditions) valued.set(condition.id, valued.get(condition.id) === true || condition.value !== null);
  }
  return [...valued].map(([id, isValued]) => ({
    id, name: REMOTE_CONDITION_NAME, color: NEUTRAL_BADGE_COLOR, ...(isValued ? { valued: true } : {}),
  }));
}
