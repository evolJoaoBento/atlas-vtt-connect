/** The `Deps` of `OnlineSessionService` that come from Atlas: the presented scene, the collections' rules, Atlas's settings. */
import type { AtlasExtension, DiceApi, LasersApi, LightingApi, TokensApi } from '@atlas-vtt/api-types';
import type { Deps } from '../OnlineSessionService';
import { liveLighting } from '../scene/sceneLighting';
import { presentedSource } from './presentedSource';
import { diceHostPart, laserRelayPart, tokenControlPart } from './toolParts';

type SessionAtlas = Pick<AtlasExtension, 'presentation' | 'views' | 'rules' | 'settings' | 'on'>;

/** The namespaces an older Atlas lacks: null where its capability is missing. */
export interface OptionalNamespaces {
  dice: DiceApi | null;
  lasers: LasersApi | null;
  lighting: LightingApi | null;
  tokens: TokensApi | null;
}

export type AtlasSessionDeps = Pick<Deps,
  'presented' | 'views' | 'collectionGrid' | 'coneAngle' | 'resources' | 'initiativeRules' | 'watchResources' | 'playerViewSettings' | 'dice' | 'laser' | 'lighting' | 'tokenControl'
>;

/**
 * Connect's own settings are not among these: the service takes them itself. Players' tokens, dice and lasers are
 * there only when this Atlas has the `tokens`, `dice` and `lasers` capabilities; without them the session hosts without
 * (without `tokens` nobody controls a token and no control list is sent).
 * Without `lighting` a scene saved lit shows players only the dark map, and the GM is told (`noLightingCapability`).
 */
export function sessionDeps(atlas: SessionAtlas, { dice, lasers, lighting, tokens }: OptionalNamespaces): AtlasSessionDeps {
  return {
    presented: presentedSource(atlas),
    views: atlas.views,
    collectionGrid: (p) => atlas.rules.forMap(p).gridDefaults,
    coneAngle: (p) => atlas.rules.forMap(p).measurement.coneAngle,
    resources: (p) => atlas.rules.forMap(p).resources,
    initiativeRules: (p) => atlas.rules.forMap(p).initiative,
    watchResources: (cb) => atlas.on('rules-changed', () => cb()),
    playerViewSettings: {
      getLocalPlayerViewSettings: () => atlas.settings.get('playerView'),
      onChange: (cb) => atlas.on('settings-changed', (key) => { if (key === 'playerView') cb(); }),
    },
    ...(tokens ? { tokenControl: tokenControlPart(tokens) } : {}),
    ...(dice ? { dice: diceHostPart(dice) } : {}),
    ...(lasers ? { laser: laserRelayPart(lasers, atlas.settings) } : {}),
    ...(lighting ? { lighting: liveLighting(lighting) } : {}),
  };
}
