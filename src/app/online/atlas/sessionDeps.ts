/** The `Deps` of `OnlineSessionService` that come from Atlas: the presented scene, the collections' rules, Atlas's settings. */
import type { AtlasExtension, DiceApi, LasersApi, LightingApi, TokensApi } from '@atlas-vtt/api-types';
import type { Deps } from '../OnlineSessionService';
import { liveLighting } from '../scene/sceneLighting';
import type { DiceLookSource } from '../scene/sceneSources';
import { presentedSource } from './presentedSource';
import type { StockMeasures } from '../../../connect/stockMeasures';
import type { ProjectedMovement } from '../scene/projectForPlayers';
import { handouts } from '../handouts';
import { createTabScenes } from './tabScenes';
import { diceHostPart, gmRollsShared, laserRelayPart, movesOnTurn, offeredRulesOf, pingRelayPart, sheetHostPart, measureHostPart, tokenControlPart, type StatblockSource } from './toolParts';

type SessionAtlas = Pick<AtlasExtension, 'presentation' | 'views' | 'rules' | 'settings' | 'on'>;

/** What a stock Atlas 0.15's rules add (`stockAtlas.ts`): each map's movement. The extension API's types know none. */
type MovementRulesApi = { movementFor?: (mapPath: string | null) => ProjectedMovement | null };

/** The namespaces an older Atlas lacks: null where its capability is missing. */
export interface OptionalNamespaces {
  dice: DiceApi | null;
  lasers: LasersApi | null;
  lighting: LightingApi | null;
  tokens: TokensApi | null;
  /** Whether this Atlas has `scene-tabs` (API 1.17.0): the GM's tabs and which one is live, for a split party. */
  sceneTabs?: boolean;
  /** Reads the stat blocks tokens link, for players' own sheets; without it sheets carry numbers only. */
  statblocks?: StatblockSource;
}

export type AtlasSessionDeps = Pick<Deps,
  'presented' | 'views' | 'diceLook' | 'collectionGrid' | 'coneAngle' | 'movement' | 'resources' | 'conditions' | 'initiativeRules' | 'watchResources' | 'playerViewSettings' | 'dice' | 'diceRules' | 'laser' | 'lighting' | 'tokenControl' | 'sheets' | 'pings' | 'templates' | 'handout'
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
export function sessionDeps(atlas: SessionAtlas, { dice, lasers, lighting, tokens, sceneTabs, statblocks }: OptionalNamespaces): AtlasSessionDeps {
  const diceLooks = diceLookSource(atlas, dice);
  const diceRules = offeredRulesOf(atlas);
  const movementFor = (atlas.rules as MovementRulesApi).movementFor;
  return {
    presented: presentedSource(atlas),
    views: atlas.views,
    collectionGrid: (p) => atlas.rules.forMap(p).gridDefaults,
    coneAngle: (p) => atlas.rules.forMap(p).measurement.coneAngle,
    ...(typeof movementFor === 'function' ? { movement: (p: string | null) => movementFor.call(atlas.rules, p) } : {}),
    resources: (p) => atlas.rules.forMap(p).resources,
    conditions: (p) => atlas.rules.forMap(p).conditions,
    initiativeRules: (p) => atlas.rules.forMap(p).initiative,
    watchResources: (cb) => atlas.on('rules-changed', () => cb()),
    playerViewSettings: {
      getLocalPlayerViewSettings: () => atlas.settings.get('playerView'),
      onChange: (cb) => atlas.on('settings-changed', (key) => { if (key === 'playerView') cb(); }),
    },
    ...(diceLooks ? { diceLook: diceLooks } : {}),
    ...(tokens ? { tokenControl: tokenControlPart(tokens, () => movesOnTurn(atlas.settings)) } : {}),
    ...(tokens ? { sheets: sheetHostPart(atlas, statblocks ?? null) } : {}),
    // Players' physical rolls are judged by the rules the board offer tells them.
    ...(dice ? { dice: diceHostPart(dice, diceRules, () => gmRollsShared(atlas.settings)), diceRules } : {}),
    ...(lasers ? { laser: laserRelayPart(lasers, atlas.settings) } : {}),
    pings: pingRelayPart(lasers),
    // Atlas's kept measures hold players' templates and spells: a stock Atlas 0.15 offers its store (`stockAtlas.ts`).
    templates: measureHostPart((atlas as { measures?: StockMeasures }).measures ?? null),
    handout: handouts,
    ...(lighting ? { lighting: liveLighting(lighting) } : {}),
    // One per hosted session, disposed with it.
    ...(sceneTabs === true && typeof atlas.views.showTab === 'function' ? { tabScenes: () => createTabScenes(atlas) } : {}),
  };
}
