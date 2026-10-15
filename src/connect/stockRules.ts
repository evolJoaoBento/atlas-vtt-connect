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
 * Everything read is checked and copied: a stock Atlas's objects are its own, never handed on.
 */
import type { ConditionDefinition, InitiativeRules, MapRules, ResourceDefinition } from '@atlas-vtt/api-types';

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
}) as ResourceDefinition;

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

function readInitiative(value: unknown): InitiativeRules | null {
  if (!isObject(value) || (value.mode !== 'turn-order' && value.mode !== 'sides')) return null;
  return Object.freeze({
    mode: value.mode,
    roll: typeof value.roll === 'string' && value.roll !== '' ? value.roll : '1d20',
    firstSide: value.firstSide === 'opponents' ? 'opponents' : 'players',
  }) as InitiativeRules;
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
  if (!stored && !resources && !conditions) return defaults;
  return Object.freeze({
    ...defaults,
    collectionId: stored?.collectionId ?? null,
    resources: resources ?? defaults.resources,
    conditions: conditions ?? defaults.conditions,
    initiative: initiative ?? defaults.initiative,
  });
}
