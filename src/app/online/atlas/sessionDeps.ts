/** The `Deps` of `OnlineSessionService` that come from Atlas: the presented scene, the collections' rules, Atlas's settings. */
import type { AtlasExtension, DiceApi, LasersApi, LightingApi, TokensApi } from '@atlas-vtt/api-types';
import type { Deps } from '../OnlineSessionService';
import { liveLighting } from '../scene/sceneLighting';
import type { DiceLookSource } from '../scene/sceneSources';
import { presentedSource } from './presentedSource';
import { createTabScenes } from './tabScenes';
import { diceHostPart, laserRelayPart, tokenControlPart } from './toolParts';

type SessionAtlas = Pick<AtlasExtension, 'presentation' | 'views' | 'rules' | 'settings' | 'on'>;

/** The namespaces an older Atlas lacks: null where its capability is missing. */
export interface OptionalNamespaces {
  dice: DiceApi | null;
  lasers: LasersApi | null;
  lighting: LightingApi | null;
  tokens: TokensApi | null;
  /** Whether this Atlas has `scene-tabs` (API 1.17.0): the GM's tabs and which one is live, for a split party. */
  sceneTabs?: boolean;
}

export type AtlasSessionDeps = Pick<Deps,
  'presented' | 'views' | 'diceLook' | 'collectionGrid' | 'coneAngle' | 'resources' | 'initiativeRules' | 'watchResources' | 'playerViewSettings' | 'dice' | 'laser' | 'lighting' | 'tokenControl'
  | 'tabScenes'
>;

/**
 * The dice look of a map's collection, over Atlas's `dice.lookFor` (API 1.18, `dice-look-choice`); null on an Atlas without it,
 * so no look is sent. A map outside every collection throws in the GM's default, which `lookFor()` answers.
 */
export function diceLookSource(atlas: Pick<AtlasExtension, 'rules' | 'on'>, dice: DiceApi | null): DiceLookSource | null {
  if (!dice || typeof dice.lookFor !== 'function') return null;
  return {
    lookFor: async (mapPath) => {
      const collectionId = atlas.rules.forMap(mapPath).collectionId;
      const answer = await dice.lookFor?.(collectionId);
      return answer?.lookId ?? null;
    },
    watch: (listener) => {
      const stops = [
        atlas.on('collections-changed', () => listener()),
        atlas.on('settings-changed', (key) => { if (key === 'diceLook') listener(); }),
        atlas.on('rules-changed', () => listener()),
      ];
      return () => { for (const stop of stops) stop(); };
    },
  };
}

/**
 * Connect's own settings are not among these: the service takes them itself. Players' tokens, dice and lasers are
 * there only when this Atlas has the `tokens`, `dice` and `lasers` capabilities; without them the session hosts without
 * (without `tokens` nobody controls a token and no control list is sent).
 * Without `lighting` a scene saved lit shows players only the dark map, and the GM is told (`noLightingCapability`).
 * Without `scene-tabs` there is no split party: every player follows the presented scene.
 */
export function sessionDeps(atlas: SessionAtlas, { dice, lasers, lighting, tokens, sceneTabs }: OptionalNamespaces): AtlasSessionDeps {
  const diceLooks = diceLookSource(atlas, dice);
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
    ...(diceLooks ? { diceLook: diceLooks } : {}),
    ...(tokens ? { tokenControl: tokenControlPart(tokens) } : {}),
    ...(dice ? { dice: diceHostPart(dice) } : {}),
    ...(lasers ? { laser: laserRelayPart(lasers, atlas.settings) } : {}),
    ...(lighting ? { lighting: liveLighting(lighting) } : {}),
    // One per hosted session, disposed with it.
    ...(sceneTabs === true && typeof atlas.views.showTab === 'function' ? { tabScenes: () => createTabScenes(atlas) } : {}),
  };
}
