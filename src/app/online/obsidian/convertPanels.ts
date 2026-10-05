/**
 * The widget bar and the initiative order as Atlas holds them. Players receive only what the
 * GM shows them, so every widget is visible to players and every entry is shown. Received maps
 * (`sharing/receive/receivedMap.ts`) and the remote view use them.
 */
import type { AnyWidget, CounterWidget, InitiativeEntry, InitiativeRules, InitiativeState, TimerWidget, TokenEntity, WidgetSettings } from '@atlas-vtt/api-types';
import { DEFAULT_INITIATIVE_RULES } from '@atlas-vtt/shared/rules';
import { createDefaultInitiativeState, DEFAULT_INITIATIVE_CONFIG } from '../../types/initiativeDefaults';
import { setOwn } from '../scene/sceneDiff';
import type { PlayerInitiative, PlayerWidget } from '../scene/sceneTypes';

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
  }));
  return {
    initiative: {
      entries,
      currentIndex: entries.findIndex((entry) => entry.isActive),
      round: initiative.round,
      isActive: initiative.active,
      config: { ...DEFAULT_INITIATIVE_CONFIG },
      // A fight by sides keeps its mode (`listedBySides`); before one, `atlasInitiativeRules` says the list is by sides
      ...(initiative.active && initiative.sides && { sides: { first: initiative.sides.first, active: initiative.sides.active ?? initiative.sides.first } }),
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
  return {
    mode: initiative?.sides ? 'sides' : 'turn-order',
    roll: DEFAULT_INITIATIVE_RULES.roll,
    firstSide: initiative?.sides?.first ?? DEFAULT_INITIATIVE_RULES.firstSide,
  };
}
