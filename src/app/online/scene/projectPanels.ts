/**
 * The widget bar and initiative tracker as players receive them, following the
 * same rules as `PlayerWidgetBar` and `PlayerInitiativePanel` in the local window.
 */
import { DEFAULT_INITIATIVE_RULES, listedBySides, sideOf } from '@atlas-vtt/shared/rules';
import type { InitiativeRules, ResourceDefinition, SceneSnapshot, TokenEntity } from '@atlas-vtt/api-types';
import { isSteppedWidget, readCounterValue } from '../../utils/counterWidget';
import { isWidgetOn } from '../../utils/widgetActivation';
import { finiteOr, oneOf, textOr, textOrNull } from './coerce';
import type { PlayerViewRules } from './playerViewRules';
import { initiativeShare } from './projectResources';
import {
  PLAYER_SIDES, PLAYER_WIDGET_TYPES, type PlayerInitiative, type PlayerInitiativeSides, type PlayerToken, type PlayerWidget,
} from './sceneTypes';
import { SCENE_LIMITS } from './sceneLimits';
import { setOwn } from './sceneDiff';
import { isSceneId } from './sceneValidation';

type WidgetState = Pick<SceneSnapshot, 'widgets'>;
type InitiativeState = Pick<SceneSnapshot, 'initiative' | 'initiativeTrackerOpen'>;

export function projectWidgets(state: WidgetState, rules: PlayerViewRules): PlayerWidget[] {
  const settings = state.widgets.settings;
  if (!rules.showWidgets || !settings?.globalVisible) return [];
  return Object.values(settings.widgets ?? {})
    .filter((widget) => typeof widget === 'object' && widget !== null && isSceneId(widget.id)
      && isWidgetOn(settings, widget) && widget.visibleToPlayers === true)
    .sort((a, b) => finiteOr(a.order, 0) - finiteOr(b.order, 0))
    .slice(0, SCENE_LIMITS.widgets)
    .map((widget) => ({
      id: widget.id,
      type: oneOf(PLAYER_WIDGET_TYPES, widget.type, 'counter'),
      label: textOr(widget.label, ''),
      icon: textOr(widget.icon, ''),
      value: finiteOr(isSteppedWidget(widget) ? readCounterValue({ widgetValues: state.widgets.values }, widget) : widget.value, 0),
    }));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * How the player window groups the initiative list, or null when it lists it in turn order (or
 * shows no list): `listedBySides` decides, from the fight's own mode while it runs and from the
 * collection's rules before it, and the first side is the fight's, else the rules'.
 */
export function projectSides(state: InitiativeState, rules: PlayerViewRules, initiativeRules: InitiativeRules): PlayerInitiativeSides | null {
  const initiative = state.initiative;
  if (!rules.showInitiative || !state.initiativeTrackerOpen || !initiative) return null;
  const stored: Record<string, unknown> | undefined = isRecord(initiative.sides) ? initiative.sides : undefined;
  if (!listedBySides({ isActive: initiative.isActive === true, ...(stored && { sides: stored as NonNullable<typeof initiative.sides> }) }, initiativeRules)) return null;
  const first = oneOf(PLAYER_SIDES, stored?.first, oneOf(PLAYER_SIDES, initiativeRules.firstSide, 'players'));
  const active = PLAYER_SIDES.find((side) => side === stored?.active);
  return active ? { first, active } : { first };
}

/**
 * `tokens` with the side of every combatant in the list `initiative` that players receive, as the window
 * files it (`sideOf`, from the GM's own token). Only a list by sides shows sides, and only a token that has
 * a sent entry gets one.
 */
export function withCombatantSides(
  tokens: Readonly<Record<string, PlayerToken>>,
  initiative: PlayerInitiative | null,
  source: Readonly<Record<string, TokenEntity>> | undefined,
): Record<string, PlayerToken> {
  const result = { ...tokens };
  if (!initiative?.sides) return result;
  for (const { tokenId } of initiative.entries) {
    if (Object.hasOwn(result, tokenId) && source && Object.hasOwn(source, tokenId)) setOwn(result, tokenId, { ...result[tokenId]!, side: sideOf(source[tokenId]) });
  }
  return result;
}

/**
 * `visibleTokenIds`: the tokens players receive, so entries of hidden and fogged tokens are dropped.
 * `definitions`: the map's resources, which decide the bar after an entry's name (`initiativeShare`).
 * `initiativeRules`: the map's collection's, which say whether a fight not yet started is listed by sides.
 *
 * By sides the window shows no numbers and no active combatant, so none is sent: every number is 0.
 */
export function projectInitiative(
  state: InitiativeState & Partial<Pick<SceneSnapshot, 'objects'>>,
  visibleTokenIds: ReadonlySet<string>,
  rules: PlayerViewRules,
  definitions: readonly ResourceDefinition[] = [],
  initiativeRules: InitiativeRules = DEFAULT_INITIATIVE_RULES,
): PlayerInitiative | null {
  const initiative = state.initiative;
  if (!rules.showInitiative || !state.initiativeTrackerOpen || !initiative) return null;
  const combat = initiative.isActive === true;
  const sides = projectSides(state, rules, initiativeRules);
  const tokens = state.objects?.tokens ?? {};
  const entries = (Array.isArray(initiative.entries) ? initiative.entries : [])
    .filter((entry) => typeof entry === 'object' && entry !== null && isSceneId(entry.id) && visibleTokenIds.has(entry.tokenId))
    .sort((a, b) => finiteOr(a.order, 0) - finiteOr(b.order, 0))
    .slice(0, SCENE_LIMITS.initiativeEntries)
    .map((entry) => ({
      id: entry.id,
      tokenId: entry.tokenId,
      initiative: sides ? 0 : finiteOr(entry.initiative, 0),
      name: rules.showTokenNameplates ? textOrNull(entry.name) : null,
      // Entries keep no HP since Atlas 0.5: the bar is the token's `hp` resource, as the player window draws it.
      hp: null,
      hpShare: initiativeShare(Object.hasOwn(tokens, entry.tokenId) ? tokens[entry.tokenId] : undefined, definitions),
      isActive: !sides && combat && entry.isActive === true,
      ...(entry.sitsOut === true && { sitsOut: true as const }),
    }));
  return { round: finiteOr(initiative.round, 0), active: combat, entries, ...(sides && { sides }) };
}
