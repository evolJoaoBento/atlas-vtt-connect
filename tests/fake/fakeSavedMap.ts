import type { InitiativeState, SavedMap, SavedMapInput, SceneLighting, WidgetSettings } from '@atlas-vtt/api-types';
import { readSceneFields, tokenSettingsForFile, type SceneFields } from './fakeMapFields';

/**
 * Atlas's saved map files as the fake keeps them (`src/api/savedMap.ts` at api-pr-13-end): the text `savedMapText`
 * writes, and what `readMap` makes of a file's state: `SavedMapInput` with widgets and initiative over Atlas's
 * defaults, lighting normalised (`readSceneLighting`), and the optional fields of 1.13.0 as Atlas loads them
 * (`fakeMapFields`). The GM's note, the dice log, explored memory, pinned previews and the loot roller stay behind.
 */

/** A map file's state as a test writes it: what Atlas saved, partial as older files are, plus anything else a file holds. */
export type FakeMapState = Omit<SavedMapInput, 'widgets' | 'initiative' | 'lighting'> & {
  widgets?: { settings?: Partial<WidgetSettings>; values?: Record<string, number> };
  initiative?: Partial<InitiativeState>;
  lighting?: Partial<SceneLighting>;
};

const DEFAULT_WIDGETS: WidgetSettings = { widgets: {}, globalVisible: true, position: 'top', scale: 1 };
const DEFAULT_INITIATIVE: InitiativeState = { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } };
const DEFAULT_LIGHTING: SceneLighting = { enabled: false, ambient: 0.1 };
const ATLAS_SCHEMA = 'atlas-vtt';
const ATLAS_VERSION = 4;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The text of a new map file at `mapPath` holding `map`, as Atlas's own save writes it (`savedMapText`). `fields` are the
 * map's optional fields, already checked; without them the file has none, as a new map before 1.13.0.
 */
export function savedMapText(map: SavedMapInput, mapPath: string, name: string, fields: SceneFields | null = null): string {
  const zones = fields && Object.keys(fields.lightZones).length > 0 ? { lightZones: fields.lightZones } : {};
  const state = {
    schema: ATLAS_SCHEMA, version: ATLAS_VERSION, name, mapPath,
    background: map.background, grid: map.grid,
    objects: {
      tokens: map.objects.tokens, fog: map.objects.fog, pins: fields?.pins ?? {}, texts: map.objects.texts, drawings: map.objects.drawings,
      walls: fields?.walls ?? {}, lights: fields?.lights ?? {}, ...zones,
    },
    camera: fields?.camera ?? { x: 0, y: 0, scale: 1 },
    widgetSettings: map.widgets.settings, widgetValues: map.widgets.values, initiative: map.initiative,
    ...(map.lighting ? { lighting: map.lighting } : {}),
    ...(fields ? { tokenSettings: tokenSettingsForFile(fields.tokenSettings) } : {}),
    ...(fields?.initiativeTrackerOpen ? { initiativeTrackerOpen: true } : {}),
  };
  return JSON.stringify({ state, version: ATLAS_VERSION }, null, 2);
}

/**
 * A map file's text for `state` as a test gives it, `extra` being what else the file holds (notes, logs, more objects).
 * Pins, walls, lights and light zones go into the file's `objects`, as Atlas saves them.
 */
export function mapFileText(state: FakeMapState, extra: Record<string, unknown> = {}): string {
  const { widgets, objects, pins, walls, lights, lightZones, ...rest } = state;
  const placed = { ...(pins && { pins }), ...(walls && { walls }), ...(lights && { lights }), ...(lightZones && { lightZones }) };
  const objectsWithExtra = { ...objects, ...placed, ...(isRecord(extra.objects) ? extra.objects : {}) };
  return JSON.stringify({
    state: { ...rest, ...extra, objects: objectsWithExtra, widgetSettings: widgets?.settings, widgetValues: widgets?.values },
    version: ATLAS_VERSION,
  });
}

/** What `readMap` hands out for a file's text, before the background's size: the fields of `SavedMapInput`, over Atlas's defaults. */
export function savedMapInput(text: string): Omit<SavedMap, 'mapSize'> {
  const state = (JSON.parse(text) as { state: Record<string, unknown> }).state;
  const objects = isRecord(state.objects) ? state.objects : {};
  const lighting = { ...DEFAULT_LIGHTING, ...(isRecord(state.lighting) ? state.lighting : {}) } as SceneLighting;
  return {
    background: (state.background ?? null) as SavedMapInput['background'],
    grid: (state.grid ?? null) as SavedMapInput['grid'],
    objects: {
      tokens: (objects.tokens ?? {}) as SavedMapInput['objects']['tokens'],
      texts: (objects.texts ?? {}) as SavedMapInput['objects']['texts'],
      drawings: (objects.drawings ?? {}) as SavedMapInput['objects']['drawings'],
      fog: (objects.fog ?? {}) as SavedMapInput['objects']['fog'],
    },
    widgets: { settings: { ...DEFAULT_WIDGETS, ...(isRecord(state.widgetSettings) ? state.widgetSettings : {}) }, values: (state.widgetValues ?? {}) as Record<string, number> },
    initiative: { ...DEFAULT_INITIATIVE, ...(isRecord(state.initiative) ? state.initiative : {}) } as InitiativeState,
    lighting,
    ...readSceneFields(state),
  };
}
