/**
 * The widget bar and initiative tracker as players receive them, following the
 * same rules as `PlayerWidgetBar` and `PlayerInitiativePanel` in the local window.
 */
import { DEFAULT_INITIATIVE_RULES } from '@atlas-vtt/shared/rules';
import { listedBySides, sideOf } from '../../../../packages/atlas-shared/src/index';
import type { AssetIds } from './sceneContracts';
import type { InitiativeRules, ResourceDefinition, SceneSnapshot, TokenEntity } from '@atlas-vtt/api-types';
import { isSteppedWidget, readCounterValue } from '../../utils/counterWidget';
import { isWidgetOn } from '../../utils/widgetActivation';
import { finiteOr, oneOf, textOr, textOrNull } from './coerce';
import type { PlayerViewRules } from './playerViewRules';
import { initiativeShare } from './projectResources';
import { COLLECTION_SHOWS, type TokenResourceShows } from './resourceVisibility';
import {
  PLAYER_SIDES, PLAYER_WIDGET_TYPES, type PlayerInitiative, type PlayerSide, type PlayerInitiativeSides, type PlayerSideRow, type PlayerToken, type PlayerWidget,
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

/** The fields of an initiative entry Atlas 0.18 added (`tokenId` became optional); the API's type predates them. */
type AtlasEntry = { tokenId?: unknown; partyMemberId?: unknown; hiddenFromPlayers?: unknown; imagePath?: unknown; name?: unknown };

/**
 * The entry's token id; none for a player at the table (whatever else it holds) or an enemy added by name (Atlas's
 * `entryToken`). An id that is no text names no token and no combatant players see (`playersSee`).
 */
function tokenOfEntry(entry: object): string | undefined {
  const { tokenId, partyMemberId } = entry as AtlasEntry;
  return partyMemberId !== undefined || typeof tokenId !== 'string' ? undefined : tokenId;
}

/**
 * Whether players see the entry, as Atlas 0.18's `playersEntryToken` decides it: never one the GM hid from them
 * (`hiddenFromPlayers`, whatever its token); a player at the table and an enemy added by name always; else while its
 * token is one of `visibleTokenIds` (those players receive: on the map, not hidden, not under fog).
 */
function playersSee(entry: object, visibleTokenIds: ReadonlySet<string>): boolean {
  if ((entry as AtlasEntry).hiddenFromPlayers) return false;
  const { tokenId: given, partyMemberId } = entry as AtlasEntry;
  // As Atlas: a party member and an entry with no token are shown; one whose token id is not an id of a token is not.
  if (partyMemberId !== undefined || given === undefined) return true;
  return typeof given === 'string' && visibleTokenIds.has(given);
}

/**
 * What players are told of a combatant without a token, as Atlas's list draws it: its art, the players' side for a
 * player at the table and the opponents' for an enemy, and its name (Atlas draws it where there is no art, `renderPlayerCard`'s
 * `shownName`; the page does the same, and an older page, which draws a name wherever there is one, shows no blank card). The
 * art is sent by the id the page loads it by, as a token's is.
 */
function tokenlessLook(entry: object, assets: Pick<AssetIds, 'idFor'> | undefined): { side: PlayerSide; image: string | null; name: string | null } {
  const { partyMemberId, imagePath, name } = entry as AtlasEntry;
  const image = typeof imagePath === 'string' && imagePath !== '' ? assets?.idFor(imagePath) ?? null : null;
  return { side: partyMemberId !== undefined ? 'players' : 'opponents', image, name: textOrNull(name) };
}

/** The group each side acts in, by its roll: sides with an equal roll share a group, counted from 0 in the order the sides act. Only the sides that have a roll. */
function rollGroups(rows: readonly SideRow[]): ReadonlyMap<string, number> {
  const groups = new Map<string, number>();
  let group = -1;
  let last: number | null = null;
  for (const row of rows) {
    if (row.roll === null) continue;
    if (row.roll !== last) group += 1;
    last = row.roll;
    groups.set(row.id, group);
  }
  return groups;
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
    sideOrder: (initiative as { sideOrder?: unknown }).sideOrder,
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
    // A combatant without a token (a player at the table, an enemy added by name) has none to file.
    if (tokenId === undefined || tokenId === '') continue;
    // A named side reads as the opponents' to an older page, which knows no other (the entry carries the real one).
    if (Object.hasOwn(result, tokenId) && source && Object.hasOwn(source, tokenId)) setOwn(result, tokenId, { ...result[tokenId]!, side: sideId !== undefined ? 'opponents' : sideOf(source[tokenId] as never) });
  }
  return result;
}

/**
 * `visibleTokenIds`: the tokens players receive, so entries of hidden and fogged tokens are dropped.
 * `definitions`: the map's resources, which decide the bar after an entry's name (`initiativeShare`).
 * `initiativeRules`: the map's collection's, which say whether a fight not yet started is listed by sides.
 *
 * Players never receive a number (Atlas 0.18: the players' list shows art only; initiative numbers, cards dealt and
 * sides' rolls stay on the GM's screen), so every `initiative` is 0 and the order is the entries' order. By sides the
 * window shows no active combatant either, so none is sent.
 *
 * The entries are those of Atlas's `playersEntryToken` (src/app/services/playerInitiativeList.ts, 0.18): none the GM
 * hid from players (`hiddenFromPlayers`), whatever its token; a player at the table (`partyMemberId`) always, on the
 * players' side; an enemy added by name (no token, no party member) always, on the opponents'; a token's entry while
 * its token is among `visibleTokenIds`. `assets` give a tokenless combatant's art the id the page loads it by.
 */
export function projectInitiative(
  state: InitiativeState & Partial<Pick<SceneSnapshot, 'objects'>>,
  visibleTokenIds: ReadonlySet<string>,
  rules: PlayerViewRules,
  definitions: readonly ResourceDefinition[] = [],
  initiativeRules: InitiativeRules = DEFAULT_INITIATIVE_RULES,
  resourceShows: TokenResourceShows = COLLECTION_SHOWS,
  assets?: Pick<AssetIds, 'idFor'>,
): PlayerInitiative | null {
  const initiative = state.initiative;
  if (!rules.showInitiative || !state.initiativeTrackerOpen || !initiative) return null;
  const combat = initiative.isActive === true;
  const rows = sideRowsOf(state, rules, initiativeRules);
  const sides = rows ? legacySides(rows, state, initiativeRules) : null;
  const sideIds = rows?.map((row) => row.id) ?? [];
  const tokens = state.objects?.tokens ?? {};
  const listedUnder = new Set<string>();
  const entries = (Array.isArray(initiative.entries) ? initiative.entries : [])
    .filter((entry) => typeof entry === 'object' && entry !== null && isSceneId(entry.id) && playersSee(entry, visibleTokenIds))
    .sort((a, b) => finiteOr(a.order, 0) - finiteOr(b.order, 0))
    .slice(0, SCENE_LIMITS.initiativeEntries)
    .map((entry) => {
      const delayed = !sides && (entry as { delayed?: unknown }).delayed === true;
      const tokenId = tokenOfEntry(entry);
      // The side the list files the combatant under (Atlas's `uk`); sent only for a named side. A combatant without a token
      // is on the players' side when it is a player at the table (Atlas's `entrySide`), else on the opponents'.
      const tokenless = tokenId === undefined ? tokenlessLook(entry, assets) : null;
      const sideId = sides ? tokenless?.side ?? tokenSideId(Object.hasOwn(tokens, tokenId!) ? tokens[tokenId!] : undefined, sideIds) : undefined;
      if (sideId !== undefined) listedUnder.add(sideId);
      // Atlas 0.18: the list shows art only. No number, no card, no "not rolled yet" dash: `initiative` is 0 (an older page requires one).
      return {
        id: entry.id,
        // A combatant without a token sends an empty id, which an older page (its validator requires text) reads as a card with no token; it never matches one.
        tokenId: tokenId ?? '',
        initiative: 0,
        name: tokenless ? tokenless.name : rules.showTokenNameplates ? textOrNull(entry.name) : null,
        // Entries keep no HP since Atlas 0.5: the bar is the token's `hp` resource, as the player window draws it.
        hp: null,
        hpShare: tokenId === undefined ? null : hpShareOf(tokens, tokenId, definitions, resourceShows),
        ...(tokenless && { side: tokenless.side, image: tokenless.image }),
        // One that delayed its turn (Atlas 0.9) waits outside the order and has no turn, as Atlas's list shows it.
        isActive: !sides && combat && entry.isActive === true && !delayed,
        ...(entry.sitsOut === true && { sitsOut: true as const }),
        ...(delayed && { delayed: true as const }),
        ...(sideId !== undefined && !isBuiltInSide(sideId) && { sideId }),
      };
    });
  // A side's roll stays on the GM's screen (Atlas 0.18); where the sides roll for the order, a row only says which sides act together.
  const groups = rollGroups(rows ?? []);
  // Only a side with a combatant in the list is named: the name of a side holding hidden combatants tells players nothing.
  const sideList = rows?.filter((row) => listedUnder.has(row.id))
    .map((row): PlayerSideRow => ({ id: row.id, name: row.name, ...(row.roll !== null && { group: groups.get(row.id)! }), ...(row.turn && { turn: true as const }) }));
  return { round: finiteOr(initiative.round, 0), active: combat, entries, ...(sides && { sides }), ...(sideList && { sideList }) };
}
