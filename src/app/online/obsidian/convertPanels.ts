/**
 * The widget bar and the initiative order as Atlas holds them. Players receive only what the
 * GM shows them, so every widget is visible to players and every entry is shown. Received maps
 * (`sharing/receive/receivedMap.ts`) and the remote view use them.
 */
import type { AnyWidget, CounterWidget, InitiativeEntry, InitiativeRules, InitiativeState, TimerWidget, TokenEntity, WidgetSettings } from '@atlas-vtt/api-types';
import { DEFAULT_INITIATIVE_RULES } from '@atlas-vtt/shared/rules';
import { createDefaultInitiativeState, DEFAULT_INITIATIVE_CONFIG } from '../../types/initiativeDefaults';
import { isBuiltInSide, type RuleSide } from '../scene/initiativeSides';
import { setOwn } from '../scene/sceneDiff';
import type { PlayerInitiative, PlayerInitiativeSides, PlayerSideRow, PlayerWidget } from '../scene/sceneTypes';

type WidgetIconName = AnyWidget['icon'];

/** The icon names older Atlas versions stored, as Atlas's `resolveWidgetIcon` maps them; Atlas resolves every other name as it draws. */
const LEGACY_WIDGET_ICONS: Readonly<Record<string, WidgetIconName>> = { timer: 'hourglass', book: 'spellbook', hand: 'strength' };

/** A received icon name as Atlas stores it: legacy names mapped, every other name passed through (unknown ones draw as Atlas's default). */
export function widgetIconName(icon: string): WidgetIconName {
  return Object.hasOwn(LEGACY_WIDGET_ICONS, icon) ? LEGACY_WIDGET_ICONS[icon]! : (icon as WidgetIconName);
}

export interface AtlasWidgets {
  widgetSettings: WidgetSettings;
  widgetValues: Record<string, number>;
}

export interface AtlasInitiative {
  initiative: InitiativeState;
  initiativeTrackerOpen: boolean;
}

/**
 * The widgets players may see, in the GM's order. Clocks show as counters (their filled count),
 * since players receive no segment count; a timer shows its remaining time, which is also its duration.
 */
export function atlasWidgets(widgets: readonly PlayerWidget[]): AtlasWidgets {
  const records: Record<string, AnyWidget> = {};
  const values: Record<string, number> = {};
  widgets.forEach((widget, order) => {
    const common = {
      id: widget.id, label: widget.label, icon: widgetIconName(widget.icon), visible: true, visibleToPlayers: true,
      value: widget.value, order, scope: 'scene' as const,
    };
    if (widget.type === 'timer') {
      const timer: TimerWidget = { ...common, type: 'timer', duration: Math.max(1, widget.value), direction: 'down' };
      setOwn(records, widget.id, timer);
      return;
    }
    const counter: CounterWidget = { ...common, type: 'counter' };
    setOwn(records, widget.id, counter);
    setOwn(values, widget.id, widget.value);
  });
  return { widgetSettings: { widgets: records, globalVisible: true, position: 'top', scale: 1 }, widgetValues: values };
}

/** The initiative order players may see; an entry's avatar is its token's art. */
export function atlasInitiative(initiative: PlayerInitiative | null, tokens: Readonly<Record<string, TokenEntity>>): AtlasInitiative {
  if (!initiative) return { initiative: createDefaultInitiativeState(), initiativeTrackerOpen: false };
  const entries = initiative.entries.map((entry, order): InitiativeEntry => ({
    id: entry.id,
    tokenId: entry.tokenId,
    name: entry.name ?? '',
    initiative: entry.initiative,
    initiativeModifier: 0,
    imagePath: Object.hasOwn(tokens, entry.tokenId) ? tokens[entry.tokenId]?.imagePath ?? '' : '',
    isActive: entry.isActive,
    isNPC: true,
    order,
    ...(entry.sitsOut === true && { sitsOut: true }),
    // Fields of Atlas 0.9 the API's type predates: the tab's list groups delayed combatants and dashes a number not rolled.
    ...(entry.delayed === true && { delayed: true }),
    ...(entry.awaiting === true && { awaitingInitiative: true }),
  }));
  return {
    initiative: {
      entries,
      currentIndex: entries.findIndex((entry) => entry.isActive),
      round: initiative.round,
      isActive: initiative.active,
      config: { ...DEFAULT_INITIATIVE_CONFIG },
      // A fight by sides keeps its mode (`listedBySides`); before one, `atlasInitiativeRules` says the list is by sides
      ...(initiative.active && initiative.sides && { sides: atlasFightSides(initiative, initiative.sides) }),
    },
    initiativeTrackerOpen: true,
  };
}

/**
 * The initiative rules the remote view's list reads: the player's own collection says nothing of the GM's table, so
 * the GM's grouping arrives as rules: by sides when the window groups by sides, else in turn order. The roll is the
 * GM's alone and is never sent.
 */
export function atlasInitiativeRules(initiative: PlayerInitiative | null): InitiativeRules {
  const named = initiative?.sideList?.some((row) => !isBuiltInSide(row.id)) === true;
  return {
    mode: initiative?.sides ? 'sides' : 'turn-order',
    roll: DEFAULT_INITIATIVE_RULES.roll,
    firstSide: initiative?.sides?.first ?? DEFAULT_INITIATIVE_RULES.firstSide,
    // The collection's named sides, as Atlas 0.10 stores them (`sides`) and the API's type predates: they list a fight not yet started.
    ...(named && initiative?.sideList ? { sides: atlasRuleSides(initiative.sideList) } : {}),
  };
}

/** The sides as Atlas stores them: a named side with its name, a built-in side by its id alone. */
function atlasRuleSides(rows: readonly PlayerSideRow[]): RuleSide[] {
  return rows.map((row) => (isBuiltInSide(row.id) ? { id: row.id } : { id: row.id, name: row.name }));
}

/**
 * A running fight's sides as Atlas holds them (`order`, and the round's rolls where the sides roll for the order), so its
 * own list shows the names, rolls and every side that acts. `active` is the first side acting now; the rest of a tie is
 * found from the rolls, as Atlas finds it.
 */
function atlasFightSides(initiative: PlayerInitiative, sides: PlayerInitiativeSides): NonNullable<InitiativeState['sides']> {
  const rows = initiative.sideList;
  if (!rows) return { first: sides.first, active: sides.active ?? sides.first };
  const rolled = rows.filter((row) => row.roll !== undefined);
  return {
    first: sides.first,
    active: rows.find((row) => row.turn === true)?.id ?? sides.active ?? sides.first,
    // Atlas derives the order of the two built-in sides from `first`; it is stored only for named sides and rolled orders.
    ...(rolled.length > 0 || rows.some((row) => !isBuiltInSide(row.id)) ? { order: atlasRuleSides(rows) } : {}),
    ...(rolled.length > 0 ? { roll: DEFAULT_INITIATIVE_RULES.roll, rolls: { [initiative.round]: Object.fromEntries(rolled.map((row) => [row.id, row.roll])) } } : {}),
  } as NonNullable<InitiativeState['sides']>;
}
