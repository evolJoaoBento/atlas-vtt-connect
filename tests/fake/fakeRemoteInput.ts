/**
 * What Atlas's remote view refuses (`remoteInput.ts`, `RemoteViewDice.checkedStatus`, `RemoteViewMotion.setCamera`),
 * mirrored so a Connect test fails where Atlas would throw. Messages follow Atlas's.
 */
import type { DiceRollResult, RemotePlayerState, RemoteSceneInput, RemoteStatus, RemoteStatusAction, ViewCamera } from '@atlas-vtt/api-types';

const MAX_REMOTE_MAP_SIDE = 100_000;
const MODES: readonly unknown[] = ['metric', 'abstract'];
const UNITS: readonly unknown[] = ['feet', 'yards', 'meters', 'units', 'custom'];
const DIAGONALS: readonly unknown[] = ['equidistant', 'alternating', 'euclidean'];
const TONES: readonly unknown[] = ['connected', 'pending', 'ended'];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isUrl = (value: unknown): boolean => value === null || typeof value === 'string';
const isSide = (value: unknown): boolean => isFiniteNumber(value) && value >= 0 && value <= MAX_REMOTE_MAP_SIDE;

function fail(method: string, what: string): never {
  throw new Error(`RemoteView.${method}: ${what}.`);
}

export function checkedScene(scene: unknown): RemoteSceneInput | null {
  if (scene === null) return null;
  const objects = isObject(scene) ? scene.objects : null;
  const shaped = isObject(scene) && isObject(scene.background) && isObject(objects) && isObject(scene.widgets)
    && isObject(scene.tokenImages) && isObject(scene.initiative) && (scene.grid === null || isObject(scene.grid))
    && ['tokens', 'texts', 'drawings', 'fog'].every((kind) => isObject(objects[kind]));
  if (!shaped) fail('setScene', 'the scene must be a RemoteSceneInput, or null');
  const background = scene.background as Record<string, unknown>;
  if (!isUrl(background.url)) fail('setScene', '"background.url" must be a string or null');
  if (!isSide(background.width) || !isSide(background.height)) fail('setScene', '"background.width" and "background.height" must be numbers in range');
  if (!Object.values(scene.tokenImages as Record<string, unknown>).every(isUrl)) fail('setScene', 'every "tokenImages" value must be a string or null');
  return scene as unknown as RemoteSceneInput;
}

function isMeasurement(value: unknown): boolean {
  return isObject(value) && MODES.includes(value.mode) && UNITS.includes(value.unitType) && DIAGONALS.includes(value.diagonalRule)
    && isFiniteNumber(value.unitDistance) && value.unitDistance > 0 && isFiniteNumber(value.coneAngle) && value.coneAngle >= 1 && value.coneAngle <= 360
    // API 1.14.0: optional, above 0 when given.
    && (value.ruleDistance === undefined || (isFiniteNumber(value.ruleDistance) && value.ruleDistance > 0))
    && Array.isArray(value.rangeBands) && value.rangeBands.every((band) => isObject(band) && isText(band.name) && isFiniteNumber(band.maxSquares));
}

export function checkedPlayer(state: unknown): RemotePlayerState {
  if (!isObject(state) || !isObject(state.tokenUi) || !isObject(state.initiative)) fail('setPlayer', 'the state must be a RemotePlayerState');
  const { movableTokenIds, measurement, tokenUi, initiative } = state;
  if (!Array.isArray(movableTokenIds) || !movableTokenIds.every(isText)) fail('setPlayer', '"movableTokenIds" must be a list of token ids');
  if (!isMeasurement(measurement)) fail('setPlayer', '"measurement" must be MeasurementSettings with a distance above 0 and a cone of 1 to 360 degrees');
  if (!Array.isArray(tokenUi.conditions) || !tokenUi.conditions.every((c) => isObject(c) && isText(c.id) && isText(c.name))) fail('setPlayer', '"tokenUi.conditions" must be condition definitions');
  const resources = tokenUi.resources;
  if (!isObject(resources) || !Object.values(resources).every((list) => Array.isArray(list) && list.every((d) => isObject(d) && isText(d.key) && typeof d.visibleToPlayers === 'boolean'))) {
    fail('setPlayer', '"tokenUi.resources" must list resource definitions by token id');
  }
  if (initiative.rules !== null && !isObject(initiative.rules)) fail('setPlayer', '"initiative.rules" must be InitiativeRules or null');
  if (!isObject(initiative.health) || !Object.values(initiative.health).every((h) => isObject(h) && isFiniteNumber(h.value) && isFiniteNumber(h.max))) {
    fail('setPlayer', '"initiative.health" values must be { value, max } numbers');
  }
  const copy = structuredClone(state) as unknown as RemotePlayerState;
  // As Atlas 1.14.0: an extension written before `ruleDistance` measures squares like cells.
  return { ...copy, measurement: { ...copy.measurement, ruleDistance: copy.measurement.ruleDistance ?? copy.measurement.unitDistance } };
}

export function checkedStatus(status: unknown): RemoteStatus {
  const given = (status ?? {}) as Partial<RemoteStatus>;
  const action = given.action;
  const actions: unknown = given.actions;
  if (actions !== undefined) {
    const list = Array.isArray(actions) ? actions as Array<Partial<RemoteStatusAction> | null> : null;
    const ids = list?.map((entry) => entry?.id);
    const entries = list !== null && list.every((entry) => isObject(entry) && isText(entry.id) && entry.id !== '' && isText(entry.label) && entry.label !== ''
      && (entry.icon === undefined || (isText(entry.icon) && entry.icon !== '')));
    // At most 3 buttons in all with `action`; ids distinct.
    if (!entries || !ids || new Set(ids).size !== ids.length || list!.length + (given.action ? 1 : 0) > 3) {
      throw new Error('RemoteView.setStatus: "actions" must be at most 3 buttons in all with "action", each with a distinct id, a label and an optional icon.');
    }
  }
  const valid = isText(given.title) && isText(given.connection) && TONES.includes(given.tone) && (given.message === null || isText(given.message))
    && (action === undefined || (isText(action.label) && typeof action.run === 'function'));
  if (!valid) throw new Error('RemoteView.setStatus: the status must be a RemoteStatus.');
  return Object.freeze({ ...given, ...(given.actions ? { actions: Object.freeze(given.actions.map((entry) => Object.freeze({ ...entry }))) } : {}) }) as RemoteStatus;
}

export function isRoll(value: unknown): value is DiceRollResult {
  const roll = value as Partial<DiceRollResult> | null;
  return typeof roll === 'object' && roll !== null && isText(roll.id) && isText(roll.formula)
    && Array.isArray(roll.rolls) && typeof roll.total === 'number' && typeof roll.timestamp === 'number';
}

export function checkedCamera(camera: unknown): ViewCamera {
  const given = camera as Partial<ViewCamera> | null;
  const valid = typeof given === 'object' && given !== null && isFiniteNumber(given.centerX) && isFiniteNumber(given.centerY)
    && isFiniteNumber(given.width) && given.width > 0 && isFiniteNumber(given.height) && given.height > 0;
  if (!valid) throw new Error('RemoteView.setCamera: the camera must be { centerX, centerY, width, height } numbers, with a size above 0.');
  return { centerX: given.centerX!, centerY: given.centerY!, width: given.width!, height: given.height! };
}

/** `remoteViews.open`'s options, checked as Atlas's `checkedOptions`. */
export function checkedOptions(options: unknown): { title: string; icon: string; reuse: boolean; maxDice: number } {
  const given = (isObject(options) ? options : {}) as Record<string, unknown>;
  if (!isText(given.title) || given.title.trim() === '') throw new Error('remoteViews.open: "title" must be a non-empty string.');
  if (given.icon !== undefined && !isText(given.icon)) throw new Error('remoteViews.open: "icon" must be a Lucide icon name.');
  if (given.reuse !== undefined && typeof given.reuse !== 'boolean') throw new Error('remoteViews.open: "reuse" must be true or false.');
  const maxDice = given.maxDice ?? 100;
  if (typeof maxDice !== 'number' || !Number.isInteger(maxDice) || maxDice < 1 || maxDice > 100) throw new Error('remoteViews.open: "maxDice" must be a whole number from 1 to 100.');
  return { title: given.title, icon: isText(given.icon) ? given.icon : 'map', reuse: given.reuse === true, maxDice };
}
