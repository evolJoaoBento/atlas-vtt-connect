/**
 * `rules.forMap` on a stock Atlas VTT, which has no extension API: a map's collection rules read where stock Atlas
 * keeps them, as Atlas's own online play reads them (`atlasView.ts`, `atlasMapLayers.ts` in Atlas 0.8).
 *
 * - A map a view shows now: the token renderer's collection sync (`getTokenRenderer().collectionSync`), the very
 *   resources and conditions Atlas draws its tokens with (its campaign system, presets and legacy bars applied).
 * - Any other map (a split party's other tabs): the asset index (`serviceManager.getAssetService()`), the collection's
 *   stored settings. Resources a collection never stored read as Atlas's HP, which players do not see by default.
 * - Neither (no view, an index not loaded yet, an Atlas that keeps them elsewhere): Atlas's defaults.
 *
 * Dice rules read first from the dice tool of a view showing the map (`getToolController().getDiceTool().getDiceRules()`:
 * the dice set Atlas's own toolbar rolls there), else the collection's stored `dice`, else the defaults.
 *
 * Everything read is checked and copied: a stock Atlas's objects are its own, never handed on.
 */
import type { CollectionGridDefaults, ConditionDefinition, DiceRules, InitiativeRules, MapRules, ResourceDefinition } from '@atlas-vtt/api-types';
import { resolveMeasurementSettings } from '@atlas-vtt/shared/grid';
import { isDieType } from '@atlas-vtt/shared/rules';
import { isBuiltInSide, readRuleSides, type RuleSide } from '../app/online/scene/initiativeSides';

/** A map view as the rules read it. */
export interface RulesView {
  mapPath(): string | null;
  /** `view.serviceManager`, unchecked. */
  readonly serviceManager?: unknown;
}

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null;

/** Calls a method of an object by name when it has one; undefined when it has none or it throws. */
function call(target: unknown, method: string, ...args: unknown[]): unknown {
  if (!isObject(target)) return undefined;
  const fn = target[method];
  if (typeof fn !== 'function') return undefined;
  try {
    return (fn as (...a: unknown[]) => unknown).apply(target, args);
  } catch {
    return undefined;
  }
}

/** Atlas's HP: what a collection without stored resources tracks (`HP_RESOURCE`). Not shown to players. */
const HP_RESOURCE: ResourceDefinition = Object.freeze({
  key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: false,
});

const DIRECTIONS = new Set(['drains', 'fills', 'static']);
const MAX_RESOURCES = 6;
const MAX_CONDITIONS = 64;

function readResource(value: unknown): ResourceDefinition | null {
  if (!isObject(value) || typeof value.key !== 'string' || value.key === '' || typeof value.name !== 'string') return null;
  const direction = typeof value.direction === 'string' && DIRECTIONS.has(value.direction) ? value.direction : 'drains';
  const resource: Rec = {
    key: value.key,
    name: value.name,
    field: typeof value.field === 'string' ? value.field : value.key,
    direction,
    color: typeof value.color === 'string' ? value.color : '#888888',
    visibleToPlayers: value.visibleToPlayers === true,
  };
  if (value.defeatedWhenSpent === true) resource.defeatedWhenSpent = true;
  if (typeof value.slot === 'number' && Number.isInteger(value.slot) && value.slot >= 0 && value.slot < MAX_RESOURCES) resource.slot = value.slot;
  return Object.freeze(resource) as unknown as ResourceDefinition;
}

function readCondition(value: unknown): ConditionDefinition | null {
  if (!isObject(value) || typeof value.id !== 'string' || value.id === '' || typeof value.name !== 'string') return null;
  const condition: Rec = { id: value.id, name: value.name, color: typeof value.color === 'string' ? value.color : '#888888' };
  if (typeof value.icon === 'string') condition.icon = value.icon;
  if (value.valued === true) condition.valued = true;
  return Object.freeze(condition) as unknown as ConditionDefinition;
}

function readList<T>(value: unknown, read: (item: unknown) => T | null, max: number): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  return Object.freeze(value.slice(0, max).map(read).filter((item): item is T => item !== null));
}

/**
 * A collection's initiative rules. Atlas 0.9's `cards` is read as it is (a list in turn order for players, never by
 * sides), not as the defaults; a side the collection named as first reads as the players', as older Atlas reads it.
 */
function readInitiative(value: unknown): InitiativeRules | null {
  if (!isObject(value) || (value.mode !== 'turn-order' && value.mode !== 'sides' && value.mode !== 'cards')) return null;
  const named = readRuleSides(value.sides);
  return Object.freeze({
    // The API's type predates `cards`; what reads the mode only asks whether it is `sides`.
    mode: value.mode as InitiativeRules['mode'],
    roll: typeof value.roll === 'string' && value.roll !== '' ? value.roll : '1d20',
    firstSide: value.firstSide === 'opponents' ? 'opponents' : 'players',
    // Atlas 0.10's named sides, kept only where they differ from the two built-in ones (as Atlas stores them).
    ...(named && !isPlainSides(named) ? { sides: Object.freeze(named.map((side) => Object.freeze(side))) } : {}),
  });
}

/** Whether a list names only the two built-in sides, unnamed: Atlas stores that as `firstSide` alone (`fAn`). */
const isPlainSides = (sides: readonly RuleSide[]): boolean => sides.length === 2 && sides.every((side) => isBuiltInSide(side.id) && side.name === undefined);

const UNIT_TYPES: readonly unknown[] = ['feet', 'yards', 'meters', 'units', 'custom'];
const MEASUREMENT_MODES: readonly unknown[] = ['metric', 'abstract'];
const DIAGONAL_RULES: readonly unknown[] = ['equidistant', 'alternating', 'euclidean'];
const MAX_RANGE_BANDS = 12;
const MAX_BAND_NAME = 40;
/** The most a distance per square may be: far past any game, short of anything that overflows a label. */
const MAX_UNIT_DISTANCE = 1_000_000;
const isPositive = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max;

/**
 * A collection's measurement rules (`gridDefaults`: the unit, the distance per square, metric or range bands, the
 * diagonal rule, the cone angle), checked field by field as Atlas reads them: null where the unit, the distance or the
 * mode is not one it knows (the map's own grid then decides, as Atlas does for a map outside a collection). A diagonal
 * rule or cone angle it cannot read is left unset, which means `equidistant` and 90 degrees.
 */
function readGridDefaults(value: unknown): CollectionGridDefaults | null {
  if (!isObject(value) || !UNIT_TYPES.includes(value.unitType) || !MEASUREMENT_MODES.includes(value.measurementMode) || !isPositive(value.unitDistance, MAX_UNIT_DISTANCE)) return null;
  const bands = Array.isArray(value.abstractRangeBands)
    ? value.abstractRangeBands.flatMap((band: unknown) => (isObject(band) && typeof band.name === 'string' && isPositive(band.maxSquares, MAX_UNIT_DISTANCE)
      ? [{ name: band.name.slice(0, MAX_BAND_NAME), maxSquares: band.maxSquares }] : [])).slice(0, MAX_RANGE_BANDS)
    : [];
  return Object.freeze({
    unitType: value.unitType as CollectionGridDefaults['unitType'],
    unitDistance: value.unitDistance,
    measurementMode: value.measurementMode as CollectionGridDefaults['measurementMode'],
    ...(bands.length > 0 ? { abstractRangeBands: Object.freeze(bands) as unknown as NonNullable<CollectionGridDefaults['abstractRangeBands']> } : {}),
    ...(DIAGONAL_RULES.includes(value.diagonalRule) ? { diagonalRule: value.diagonalRule as NonNullable<CollectionGridDefaults['diagonalRule']> } : {}),
    // A cone opens by more than nothing and at most a full turn (Atlas's `n0t`).
    ...(isPositive(value.coneAngle, 360) ? { coneAngle: value.coneAngle } : {}),
  });
}

const CRITS: readonly unknown[] = ['natural', 'roll-under', 'doubles', 'high-total', 'none'];
const isFaceCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** One dice group, `NdS`, of a die Atlas rolls. */
const isDiceGroup = (value: unknown): value is string => {
  const match = typeof value === 'string' ? /^(\d*)d(\d+)$/.exec(value) : null;
  return match !== null && (match[1] === '' || Number(match[1]) >= 1) && isDieType(`d${Number(match[2])}`);
};

/** `NdS` of a dice set's groups (`[{count, sides}]`); null for mixed dice, which have no one default die. */
function groupsRoll(groups: unknown[]): string | null {
  let count = 0;
  let sides: unknown = null;
  for (const group of groups) {
    if (!isObject(group) || !isFaceCount(group.count) || group.count < 1) return null;
    if (sides !== null && group.sides !== sides) return null;
    sides = group.sides;
    count += group.count;
  }
  return count > 0 && typeof sides === 'number' ? `${count}d${sides}` : null;
}

/**
 * Dice rules as Atlas stores them, a collection's `dice` (`defaultRoll`) or a dice set's (`dice: [{count, sides}]`),
 * each field it cannot read as the default's; an explode rule it cannot read is dropped.
 */
function readDice(value: unknown, defaults: DiceRules): DiceRules | null {
  if (!isObject(value)) return null;
  const written = Array.isArray(value.dice) ? groupsRoll(value.dice) : value.defaultRoll;
  const rules: { -readonly [K in keyof DiceRules]: DiceRules[K] } = {
    defaultRoll: isDiceGroup(written) ? written : defaults.defaultRoll,
    crit: CRITS.includes(value.crit) ? value.crit as DiceRules['crit'] : defaults.crit,
  };
  const { explode } = value;
  if (isObject(explode) && (explode.dice === 'default' || explode.dice === 'all') && typeof explode.repeats === 'boolean'
    && isFaceCount(explode.highFaces) && isFaceCount(explode.lowFaces)) {
    rules.explode = Object.freeze({ dice: explode.dice, repeats: explode.repeats, highFaces: explode.highFaces, lowFaces: explode.lowFaces });
  }
  return Object.freeze(rules);
}

/** The dice set a view's dice tool rolls for the map it shows. */
function toolDice(view: RulesView): unknown {
  return call(call(call(view.serviceManager, 'getToolController'), 'getDiceTool'), 'getDiceRules');
}

/** The collection sync of a view's token renderer: Atlas's own resources and conditions for the map it shows. */
function collectionSyncOf(view: RulesView): Rec | null {
  const renderer = call(call(view.serviceManager, 'getRendererService'), 'getRenderer');
  const tokens = call(renderer, 'getTokenRenderer');
  const sync = isObject(tokens) ? tokens.collectionSync : undefined;
  return isObject(sync) ? sync : null;
}

/** The asset index's stored settings for the map's collection, with its id; null when the index cannot say. */
function storedSettings(views: readonly RulesView[], mapPath: string): { collectionId: string; settings: Rec } | null {
  for (const view of views) {
    const assets = call(view.serviceManager, 'getAssetService');
    const collectionId = call(assets, 'getCollectionForMap', mapPath);
    if (typeof collectionId !== 'string' || collectionId === '') continue;
    const settings = call(assets, 'getCollectionSettings', collectionId);
    if (isObject(settings)) return { collectionId, settings };
  }
  return null;
}

/** `rules.forMap` for a stock Atlas: `defaults` with what the map's collection says over them. */
export function stockMapRules(views: readonly RulesView[], mapPath: string | null, defaults: MapRules): MapRules {
  if (!mapPath) return defaults;
  const stored = storedSettings(views, mapPath);
  const showing = views.find((view) => view.mapPath() === mapPath);
  const sync = showing ? collectionSyncOf(showing) : null;
  const resources = (sync ? readList(call(sync, 'resources'), readResource, MAX_RESOURCES) : null)
    ?? (stored ? readList(stored.settings.resources, readResource, MAX_RESOURCES) ?? Object.freeze([HP_RESOURCE]) : null);
  const conditions = (sync ? readList(call(sync, 'conditions'), readCondition, MAX_CONDITIONS) : null)
    ?? (stored ? readList(stored.settings.conditions, readCondition, MAX_CONDITIONS) : null);
  const initiative = stored ? readInitiative(stored.settings.initiative) : null;
  // A dice set the tool cannot give a default roll for (mixed dice) takes the collection's stored one before the defaults.
  const storedDice = stored ? readDice(stored.settings.dice, defaults.dice) : null;
  const dice = (showing ? readDice(toolDice(showing), storedDice ?? defaults.dice) : null) ?? storedDice;
  // How the map measures: the collection's own rules, which the map's grid only completes (a scene's own distance per cell).
  const gridDefaults = stored ? readGridDefaults(stored.settings.gridDefaults) : null;
  if (!stored && !resources && !conditions && !dice) return defaults;
  return Object.freeze({
    ...defaults,
    collectionId: stored?.collectionId ?? null,
    ...(gridDefaults ? {
      gridDefaults,
      measurement: Object.freeze({ ...resolveMeasurementSettings(gridDefaults, null), coneAngle: gridDefaults.coneAngle ?? defaults.measurement.coneAngle }),
    } : {}),
    resources: resources ?? defaults.resources,
    conditions: conditions ?? defaults.conditions,
    initiative: initiative ?? defaults.initiative,
    dice: dice ?? defaults.dice,
  });
}
