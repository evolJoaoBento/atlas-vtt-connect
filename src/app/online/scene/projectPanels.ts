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
import { COLLECTION_SHOWS, type TokenResourceShows } from './resourceVisibility';
import {
  PLAYER_SIDES, PLAYER_WIDGET_TYPES, type PlayerInitiative, type PlayerInitiativeSides, type PlayerSideRow, type PlayerToken, type PlayerWidget,
} from './sceneTypes';
import { SCENE_LIMITS } from './sceneLimits';
import { setOwn } from './sceneDiff';
import { isSceneId } from './sceneValidation';
import { isBuiltInSide, legacyActive, readRuleSides, sideRows, tokenSideId, type SideRow } from './initiativeSides';

/** The initiative list's bar for the token `tokenId`, by what the GM lets players see of its `hp`. */
function hpShareOf(tokens: Readonly<Record<string, TokenEntity>>, tokenId: string, definitions: readonly ResourceDefinition[], resourceShows: TokenResourceShows): number | null {
  const token = Object.hasOwn(tokens, tokenId) ? tokens[tokenId] : undefined;
  if (!token) return null;
  const showOf = resourceShows(tokenId, token.kind === 'character' ? token : {});
  return initiativeShare(token, definitions, showOf);
}

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
  const rows = sideRowsOf(state, rules, initiativeRules);
  return rows ? legacySides(rows, state, initiativeRules) : null;
}

/** The sides as an older page reads them: the built-in side that acts first, and the first of them that acts now (none where only named sides do). */
function legacySides(rows: readonly SideRow[], state: InitiativeState, initiativeRules: InitiativeRules): PlayerInitiativeSides {
  const stored: Record<string, unknown> | undefined = isRecord(state.initiative.sides) ? state.initiative.sides : undefined;
  const first = oneOf(PLAYER_SIDES, stored?.first, oneOf(PLAYER_SIDES, initiativeRules.firstSide, 'players'));
  const active = legacyActive(rows);
  return active ? { first, active } : { first };
}

/**
 * Every side the player window lists, in the order they act (Atlas's `Y2e`), or null when it lists no sides: the same
 * test as `projectSides`. The collection's named sides come with its initiative rules (`sides`).
 */
function sideRowsOf(state: InitiativeState, rules: PlayerViewRules, initiativeRules: InitiativeRules): SideRow[] | null {
  const initiative = state.initiative;
  if (!rules.showInitiative || !state.initiativeTrackerOpen || !initiative) return null;
  const stored: Record<string, unknown> | undefined = isRecord(initiative.sides) ? initiative.sides : undefined;
  if (!listedBySides({ isActive: initiative.isActive === true, ...(stored && { sides: stored as NonNullable<typeof initiative.sides> }) }, initiativeRules)) return null;
  return sideRows({
    active: initiative.isActive === true,
    round: finiteOr(initiative.round, 0),
    fight: stored,
    rulesSides: readRuleSides((initiativeRules as { sides?: unknown }).sides),
    firstSide: oneOf(PLAYER_SIDES, initiativeRules.firstSide, 'players'),
  });
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
  for (const { tokenId, sideId } of initiative.entries) {
    // A named side reads as the opponents' to an older page, which knows no other (the entry carries the real one).
    if (Object.hasOwn(result, tokenId) && source && Object.hasOwn(source, tokenId)) setOwn(result, tokenId, { ...result[tokenId]!, side: sideId !== undefined ? 'opponents' : sideOf(source[tokenId]) });
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
  resourceShows: TokenResourceShows = COLLECTION_SHOWS,
): PlayerInitiative | null {
  const initiative = state.initiative;
  if (!rules.showInitiative || !state.initiativeTrackerOpen || !initiative) return null;
  const combat = initiative.isActive === true;
  const rows = sideRowsOf(state, rules, initiativeRules);
  const sides = rows ? legacySides(rows, state, initiativeRules) : null;
  const sideIds = rows?.map((row) => row.id) ?? [];
  // Atlas 0.9's fight by cards: a combatant's number is the card it was dealt, as Atlas's players' list shows it.
  const byCards = combat && isRecord((initiative as { cards?: unknown }).cards);
  const tokens = state.objects?.tokens ?? {};
  const listedUnder = new Set<string>();
  const entries = (Array.isArray(initiative.entries) ? initiative.entries : [])
    .filter((entry) => typeof entry === 'object' && entry !== null && isSceneId(entry.id) && visibleTokenIds.has(entry.tokenId))
    .sort((a, b) => finiteOr(a.order, 0) - finiteOr(b.order, 0))
    .slice(0, SCENE_LIMITS.initiativeEntries)
    .map((entry) => {
      const delayed = !sides && (entry as { delayed?: unknown }).delayed === true;
      // Atlas's list shows a dash for a number not rolled yet (`awaitingInitiative` at 0) and for a card not dealt.
      const awaiting = !sides && (byCards
        ? !Number.isFinite((entry as { card?: unknown }).card)
        : (entry as { awaitingInitiative?: unknown }).awaitingInitiative === true && entry.initiative === 0);
      // The side the list files the combatant under (Atlas's `uk`); sent only for a named side.
      const sideId = sides ? tokenSideId(Object.hasOwn(tokens, entry.tokenId) ? tokens[entry.tokenId] : undefined, sideIds) : undefined;
      if (sideId !== undefined) listedUnder.add(sideId);
      return {
        id: entry.id,
        tokenId: entry.tokenId,
        initiative: sides ? 0 : finiteOr(byCards ? (entry as { card?: unknown }).card : entry.initiative, 0),
        name: rules.showTokenNameplates ? textOrNull(entry.name) : null,
        // Entries keep no HP since Atlas 0.5: the bar is the token's `hp` resource, as the player window draws it.
        hp: null,
        hpShare: hpShareOf(tokens, entry.tokenId, definitions, resourceShows),
        // One that delayed its turn (Atlas 0.9) waits outside the order and has no turn, as Atlas's list shows it.
        isActive: !sides && combat && entry.isActive === true && !delayed,
        ...(entry.sitsOut === true && { sitsOut: true as const }),
        ...(delayed && { delayed: true as const }),
        ...(awaiting && { awaiting: true as const }),
        ...(sideId !== undefined && !isBuiltInSide(sideId) && { sideId }),
      };
    });
  // Only a side with a combatant in the list is named: the name of a side holding hidden combatants tells players nothing.
  const sideList = rows?.filter((row) => listedUnder.has(row.id))
    .map((row): PlayerSideRow => ({ id: row.id, name: row.name, ...(row.roll !== null && { roll: row.roll }), ...(row.turn && { turn: true as const }) }));
  return { round: finiteOr(initiative.round, 0), active: combat, entries, ...(sides && { sides }), ...(sideList && { sideList }) };
}
