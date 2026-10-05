import { normalizePath } from 'obsidian';
import type { LightSource, LightZone, NotePin, SavedMapInput, TokenSettings, WallSegment } from '@atlas-vtt/api-types';
import { mapStrings } from './mapStrings';

/**
 * The optional fields of a saved map beyond its scene (API 1.13.0), as Atlas's `src/api/savedMapFields.ts` at
 * api-pr-13-end: pins, walls, lights, light zones, camera, token settings and the tracker. `readSceneFields` reads a
 * file leniently, as Atlas loads it; `checkedSceneFields` checks them strictly, throwing, before `addToCollection` or
 * `replaceMap` writes anything.
 */

type Camera = NonNullable<SavedMapInput['camera']>;
export interface SceneFields {
  pins: Readonly<Record<string, NotePin>>;
  walls: Readonly<Record<string, WallSegment>>;
  lights: Readonly<Record<string, LightSource>>;
  lightZones: Readonly<Record<string, LightZone>>;
  camera: Camera;
  tokenSettings: TokenSettings;
  initiativeTrackerOpen: boolean;
}

const DEFAULT_TOKEN_SETTINGS: TokenSettings = { showNameplates: false, hiddenResources: [], showInstanceBadges: true, tokenRingSize: 1 };
const HP = 'hp';
const STRESS = 'stress';

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Whether `path` is a plain relative path: no empty, `.` or `..` segment, no leading slash or backslash, no control character. */
export function isPlainRelative(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length < 1024 && !path.includes('\\') && !path.startsWith('/')
    && ![...path].some((character) => character.charCodeAt(0) < 0x20)
    && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const isCamera = (value: unknown): value is Camera =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.scale) && value.scale > 0;

const TOKEN_SETTING_CHECKS: { [Key in keyof TokenSettings]: (value: unknown) => boolean } = {
  showNameplates: (value) => typeof value === 'boolean',
  hiddenResources: (value) => Array.isArray(value) && value.every((key) => typeof key === 'string'),
  showInstanceBadges: (value) => typeof value === 'boolean',
  tokenRingSize: (value) => isFiniteNumber(value) && value > 0,
};

function tokenSettingsOver(given: Record<string, unknown>): TokenSettings {
  const settings: Record<string, unknown> = { ...DEFAULT_TOKEN_SETTINGS, hiddenResources: [] };
  for (const [key, check] of Object.entries(TOKEN_SETTING_CHECKS)) if (check(given[key])) settings[key] = given[key];
  return settings as unknown as TokenSettings;
}

function withHidden(hidden: readonly string[], key: string, isHidden: boolean): string[] {
  if (hidden.includes(key) === isHidden) return [...hidden];
  return isHidden ? [...hidden, key] : hidden.filter((other) => other !== key);
}

/** Atlas's `tokenSettingsFromFile`: the bar switches of older files become `hiddenResources`. */
function tokenSettingsFromFile(settings: Record<string, unknown>): Record<string, unknown> {
  const { showHPBars, showStressBars, showResources, ...rest } = settings;
  const hasSwitches = 'showHPBars' in settings || 'showStressBars' in settings;
  if (!hasSwitches && !('showResources' in settings)) return settings;
  let hidden = Array.isArray(rest.hiddenResources) ? rest.hiddenResources.filter((key): key is string => typeof key === 'string') : [];
  if (hasSwitches) {
    hidden = withHidden(hidden, HP, showHPBars === false);
    hidden = withHidden(hidden, STRESS, showStressBars !== true);
  } else if (showResources === false) {
    hidden = [HP, STRESS];
  }
  return { ...rest, hiddenResources: hidden };
}

/** Atlas's `tokenSettingsToFile`: the list, with the two bar switches beside it. */
export function tokenSettingsForFile(settings: TokenSettings): Record<string, unknown> {
  return { ...settings, showHPBars: !settings.hiddenResources.includes(HP), showStressBars: !settings.hiddenResources.includes(STRESS) };
}

const recordOf = <T>(value: unknown): Readonly<Record<string, T>> => (isRecord(value) ? (value as Record<string, T>) : {});

/** The optional fields of a file's state, as Atlas loads them: what cannot be read falls back to what a new map has. */
export function readSceneFields(state: Record<string, unknown>): SceneFields {
  const objects = isRecord(state.objects) ? state.objects : {};
  return {
    pins: recordOf<NotePin>(objects.pins),
    walls: recordOf<WallSegment>(objects.walls),
    lights: recordOf<LightSource>(objects.lights),
    lightZones: recordOf<LightZone>(objects.lightZones),
    camera: isCamera(state.camera) ? state.camera : { x: 0, y: 0, scale: 1 },
    tokenSettings: tokenSettingsOver(isRecord(state.tokenSettings) ? tokenSettingsFromFile(state.tokenSettings) : {}),
    initiativeTrackerOpen: state.initiativeTrackerOpen === true,
  };
}

function fail(message: string): never {
  throw new Error(`[Atlas API] ${message}`);
}

function checkedPin(id: string, value: unknown): NotePin {
  if (!isRecord(value)) fail(`The pin "${id}" must be a note pin.`);
  const { id: pinId, kind, x, y, notePath, icon, label, gmOnly, hex } = value;
  const optional = (field: unknown, type: 'string' | 'boolean'): boolean => field === undefined || typeof field === type;
  const path = typeof notePath === 'string' ? normalizePath(notePath) : notePath;
  if (typeof pinId !== 'string' || kind !== 'pin' || !isFiniteNumber(x) || !isFiniteNumber(y) || !isPlainRelative(path)
    || !optional(icon, 'string') || !optional(label, 'string') || !optional(gmOnly, 'boolean') || !optional(hex, 'boolean')) {
    fail(`The pin "${id}" must be { id, kind: 'pin', x, y, notePath } with a plain vault path.`);
  }
  return {
    id: pinId, kind, x, y, notePath: path,
    ...(typeof icon === 'string' && { icon }), ...(typeof label === 'string' && { label }),
    ...(typeof gmOnly === 'boolean' && { gmOnly }), ...(typeof hex === 'boolean' && { hex }),
  };
}

function checkedRecord<T>(field: string, value: unknown): Record<string, T> {
  if (!isRecord(value)) fail(`The map's "${field}" must be a record by id.`);
  return value as Record<string, T>;
}

function checkedTokenSettings(value: unknown): TokenSettings {
  if (!isRecord(value)) fail('The map\'s "tokenSettings" must be an object.');
  for (const [key, check] of Object.entries(TOKEN_SETTING_CHECKS)) {
    if (value[key] !== undefined && !check(value[key])) fail(`The token setting "${key}" has the wrong type.`);
  }
  return tokenSettingsOver(value);
}

const FIELDS = ['pins', 'walls', 'lights', 'lightZones', 'camera', 'tokenSettings', 'initiativeTrackerOpen'] as const;

/** The optional fields of `map`, checked (throws on the first malformed one); null when it sets none, so the file is as before 1.13.0. */
export function checkedSceneFields(map: SavedMapInput): SceneFields | null {
  const given = map as Partial<Record<(typeof FIELDS)[number], unknown>>;
  if (!FIELDS.some((field) => given[field] !== undefined)) return null;
  const pins = given.pins === undefined ? {} : checkedRecord<unknown>('pins', given.pins);
  if (given.camera !== undefined && !isCamera(given.camera)) fail('The map\'s "camera" must be finite x and y with a scale above 0.');
  if (given.lightZones !== undefined && !isRecord(given.lightZones)) fail('The map\'s "lightZones" must be a record by id.');
  const camera = given.camera as Camera | undefined;
  return {
    pins: Object.fromEntries(Object.entries(pins).map(([id, pin]) => [id, checkedPin(id, pin)])),
    walls: given.walls === undefined ? {} : checkedRecord<WallSegment>('walls', given.walls),
    lights: given.lights === undefined ? {} : checkedRecord<LightSource>('lights', given.lights),
    lightZones: recordOf<LightZone>(given.lightZones),
    camera: camera ? { x: camera.x, y: camera.y, scale: camera.scale } : { x: 0, y: 0, scale: 1 },
    tokenSettings: given.tokenSettings === undefined ? tokenSettingsOver({}) : checkedTokenSettings(given.tokenSettings),
    initiativeTrackerOpen: given.initiativeTrackerOpen === true,
  };
}

/**
 * `map`'s scene with every string naming an uploaded image turned into its vault path (Atlas's `withImagePaths`). Only
 * the scene's own parts are rewritten: a pin's `notePath` and the other optional fields are vault data.
 */
export function withImagePaths(map: SavedMapInput, imagePaths: ReadonlyMap<string, string>): SavedMapInput {
  const rewrite = (text: string): string => imagePaths.get(text) ?? text;
  const { background, grid, objects, widgets, initiative, lighting } = map;
  const scene = mapStrings({ background, grid, objects, widgets, initiative }, rewrite);
  return { ...scene, ...(lighting ? { lighting: mapStrings(lighting, rewrite) } : {}) };
}
