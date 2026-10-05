import type { InitiativeState, SavedMapInput, SceneLighting, WidgetSettings } from '@atlas-vtt/api-types';

/**
 * Atlas's saved map files as the fake keeps them (`src/api/savedMap.ts` at api-pr-11-end): the text `savedMapText`
 * writes, and what `readMap` makes of a file's state: only `SavedMapInput`, widgets and initiative over Atlas's
 * defaults, lighting normalised (`readSceneLighting`).
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

/** The text of a new map file at `mapPath` holding `map`, as Atlas's own save writes it (`savedMapText`). */
export function savedMapText(map: SavedMapInput, mapPath: string, name: string): string {
  const state = {
    schema: ATLAS_SCHEMA, version: ATLAS_VERSION, name, mapPath,
    background: map.background, grid: map.grid,
    objects: { tokens: map.objects.tokens, fog: map.objects.fog, pins: {}, texts: map.objects.texts, drawings: map.objects.drawings, walls: {}, lights: {} },
    camera: { x: 0, y: 0, scale: 1 },
    widgetSettings: map.widgets.settings, widgetValues: map.widgets.values, initiative: map.initiative,
    ...(map.lighting ? { lighting: map.lighting } : {}),
  };
  return JSON.stringify({ state, version: ATLAS_VERSION }, null, 2);
}

/** A map file's text for `state` as a test gives it, `extra` being what else the file holds (pins, notes, logs). */
export function mapFileText(state: FakeMapState, extra: Record<string, unknown> = {}): string {
  const { widgets, objects, ...rest } = state;
  const objectsWithExtra = { ...objects, ...(isRecord(extra.objects) ? extra.objects : {}) };
  return JSON.stringify({
    state: { ...rest, ...extra, objects: objectsWithExtra, widgetSettings: widgets?.settings, widgetValues: widgets?.values },
    version: ATLAS_VERSION,
  });
}

/** What `readMap` hands out for a file's text: only the fields of `SavedMapInput`, over Atlas's defaults. */
export function savedMapInput(text: string): SavedMapInput {
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
  };
}
