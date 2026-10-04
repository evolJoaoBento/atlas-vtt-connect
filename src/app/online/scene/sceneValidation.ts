/**
 * Checks for scene messages. Shared with the web player page, so this file
 * imports only the wire types. Records are read by their own keys only, and
 * ids that assignment treats specially are refused, so applying a validated
 * patch can never reach an object's prototype.
 */
import {
  PLAYER_DIAGONAL_RULES, PLAYER_DRAWING_TYPES, PLAYER_CELL_NUMBERS, PLAYER_GRID_LINES, PLAYER_GRID_TYPES, PLAYER_HEX_NUMBERS,
  PLAYER_MEASUREMENT_MODES, PLAYER_SIDES, PLAYER_TEXT_ALIGNS, PLAYER_UNIT_TYPES, PLAYER_WIDGET_TYPES,
  SCENE_FIELD_KEYS, SCENE_RECORD_KEYS, type SceneFieldKey, type SceneRecordKey,
} from './sceneTypes';
import { SCENE_LIMITS, SCENE_RANGES } from './sceneLimits';

type Fields = Record<string, unknown>;
type Check = (value: unknown) => boolean;

const FORBIDDEN_IDS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
type Range = readonly [number, number];
function inRange(range: Range): (value: unknown) => value is number {
  return (value): value is number => isNumber(value) && value >= range[0] && value <= range[1];
}
const isCoordinate = inRange(SCENE_RANGES.coordinate);
const isStroke = inRange(SCENE_RANGES.stroke);
const isOpacity = inRange(SCENE_RANGES.opacity);
function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}
function isString(value: unknown): value is string {
  return isText(value, SCENE_LIMITS.stringLength);
}
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}
function nullable(check: Check): Check {
  return (value) => value === null || check(value);
}
function oneOf(values: readonly string[]): Check {
  return (value) => typeof value === 'string' && values.includes(value);
}

/** A record key or entity id: short, and never one assignment treats specially. */
export function isSceneId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= SCENE_LIMITS.idLength && !FORBIDDEN_IDS.has(value);
}
export function isSceneSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}
/** The `seq` a player last applied: 0 before its first message. */
export function isLastSeq(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
export function isSceneCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= SCENE_LIMITS.records;
}

/** A `scene-camera`: a centre within the coordinate range and a positive size within it. */
export function isSceneCamera(message: Fields): boolean {
  const isExtent = (value: unknown): boolean => isCoordinate(value) && value > 0;
  return isSceneId(message.sceneId) && isCoordinate(message.centerX) && isCoordinate(message.centerY)
    && isExtent(message.width) && isExtent(message.height);
}

function isPoint(value: unknown): boolean {
  return isFields(value) && isCoordinate(value.x) && isCoordinate(value.y);
}
function isPoints(value: unknown, min: number): boolean {
  return Array.isArray(value) && value.length >= min && value.length <= SCENE_LIMITS.points
    && value.every((point) => isPoint(point));
}
function isLegacyBar(value: unknown): boolean {
  return isFields(value) && isNumber(value.current) && isNumber(value.max);
}
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const isUnit = inRange([0, 1]);
function isResource(value: unknown): boolean {
  return isFields(value) && typeof value.color === 'string' && HEX_COLOR.test(value.color) && isUnit(value.share) && isBoolean(value.spent);
}
function isResources(value: unknown): boolean {
  return Array.isArray(value) && value.length <= SCENE_LIMITS.resources && value.every((bar) => isResource(bar));
}
/** An optional field: a GM of an older version sends none. */
function optional(check: Check): Check {
  return (value) => value === undefined || check(value);
}
function isCondition(value: unknown): boolean {
  return isFields(value) && isText(value.id, SCENE_LIMITS.idLength) && (value.value === null || isNumber(value.value));
}

function isPlayerMap(value: unknown): boolean {
  return isFields(value) && nullable(isString)(value.asset) && inRange(SCENE_RANGES.mapSize)(value.width)
    && inRange(SCENE_RANGES.mapSize)(value.height) && inRange(SCENE_RANGES.cellSize)(value.cellSize);
}

function isPlayerGrid(value: unknown): boolean {
  return isFields(value) && oneOf(PLAYER_GRID_TYPES)(value.type) && inRange(SCENE_RANGES.gridSize)(value.size)
    && isCoordinate(value.offsetX) && isCoordinate(value.offsetY) && nullable(isString)(value.color) && isOpacity(value.opacity)
    && oneOf(PLAYER_GRID_LINES)(value.lineType) && isStroke(value.lineWidth)
    && nullable(oneOf(PLAYER_HEX_NUMBERS))(value.hexNumbers) && nullable(isOpacity)(value.hexNumberOpacity)
    && optional(nullable(oneOf(PLAYER_CELL_NUMBERS)))(value.cellNumbers) && optional(nullable(isOpacity))(value.cellNumberOpacity);
}

function isPlayerToken(value: unknown): boolean {
  return isFields(value) && isCoordinate(value.x) && isCoordinate(value.y) && inRange(SCENE_RANGES.tokenSize)(value.size)
    && isNumber(value.rotation)
    && isNumber(value.layer) && nullable(isString)(value.image) && nullable(isString)(value.ring)
    && Array.isArray(value.conditions) && value.conditions.length <= SCENE_LIMITS.conditions
    && value.conditions.every((condition) => isCondition(condition))
    && nullable(isString)(value.name) && optional(nullable(isLegacyBar))(value.hp) && optional(nullable(isLegacyBar))(value.stress)
    && optional(isResources)(value.resources) && optional(isBoolean)(value.downed) && optional(oneOf(PLAYER_SIDES))(value.side);
}

function isPlayerFogOp(value: unknown): boolean {
  if (!isFields(value) || !isBoolean(value.erase) || !isNumber(value.order)) return false;
  switch (value.type) {
    case 'brush': return isStroke(value.radius) && value.radius > 0 && isPoints(value.points, 1);
    case 'lasso': return isPoints(value.points, 3);
    case 'rectangle': return isCoordinate(value.x) && isCoordinate(value.y) && isCoordinate(value.width) && isCoordinate(value.height);
    default: return false;
  }
}

function isPlayerText(value: unknown): boolean {
  return isFields(value) && isCoordinate(value.x) && isCoordinate(value.y) && isText(value.text, SCENE_LIMITS.textLength)
    && inRange(SCENE_RANGES.fontSize)(value.fontSize) && isString(value.fontFamily) && isString(value.color)
    && nullable(isString)(value.backgroundColor) && isStroke(value.padding) && isStroke(value.borderRadius)
    && isOpacity(value.opacity) && nullable(inRange(SCENE_RANGES.textBox))(value.width)
    && nullable(inRange(SCENE_RANGES.textBox))(value.height)
    && oneOf(PLAYER_TEXT_ALIGNS)(value.align) && isBoolean(value.bold) && isBoolean(value.italic)
    && isNumber(value.rotation) && inRange(SCENE_RANGES.textScale)(value.scale);
}

function isPlayerDrawing(value: unknown): boolean {
  return isFields(value) && oneOf(PLAYER_DRAWING_TYPES)(value.type) && isNumber(value.order) && isPoints(value.points, 1)
    && isString(value.color) && isStroke(value.width) && isOpacity(value.opacity) && nullable(isString)(value.icon);
}

function isPlayerWidget(value: unknown): boolean {
  return isFields(value) && isText(value.id, SCENE_LIMITS.idLength) && oneOf(PLAYER_WIDGET_TYPES)(value.type)
    && isString(value.label) && isString(value.icon) && isNumber(value.value);
}
function isPlayerWidgets(value: unknown): boolean {
  return Array.isArray(value) && value.length <= SCENE_LIMITS.widgets && value.every((widget) => isPlayerWidget(widget));
}

function isInitiativeEntry(value: unknown): boolean {
  return isFields(value) && isText(value.id, SCENE_LIMITS.idLength) && isText(value.tokenId, SCENE_LIMITS.idLength)
    && isNumber(value.initiative) && nullable(isString)(value.name) && optional(nullable(isLegacyBar))(value.hp)
    && optional(nullable(isUnit))(value.hpShare) && isBoolean(value.isActive) && optional((flag) => flag === true)(value.sitsOut);
}
function isPlayerSides(value: unknown): boolean {
  return isFields(value) && oneOf(PLAYER_SIDES)(value.first) && optional(oneOf(PLAYER_SIDES))(value.active);
}
function isPlayerInitiative(value: unknown): boolean {
  return isFields(value) && isNumber(value.round) && isBoolean(value.active) && Array.isArray(value.entries)
    && value.entries.length <= SCENE_LIMITS.initiativeEntries && value.entries.every((entry) => isInitiativeEntry(entry))
    && optional(isPlayerSides)(value.sides);
}

function isRecordOf(value: unknown, check: Check): boolean {
  if (!isFields(value)) return false;
  const ids = Object.keys(value);
  return ids.length <= SCENE_LIMITS.records && ids.every((id) => isSceneId(id) && check(value[id]));
}
function isIdList(value: unknown): boolean {
  return Array.isArray(value) && value.length <= SCENE_LIMITS.records && value.every((id) => isSceneId(id));
}

/** More than 0 and at most a full turn, in degrees, as Atlas's `isValidConeAngle`. */
function isConeAngle(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 360;
}

function isRangeBand(value: unknown): boolean {
  return isFields(value) && isText(value.name, SCENE_LIMITS.idLength) && inRange(SCENE_RANGES.rangeBand)(value.maxSquares);
}
function isSnapGrid(value: unknown): boolean {
  return isFields(value) && oneOf(PLAYER_GRID_TYPES)(value.type) && inRange(SCENE_RANGES.gridSize)(value.size)
    && isCoordinate(value.offsetX) && isCoordinate(value.offsetY);
}
function isPlayerMeasurement(value: unknown): boolean {
  return isFields(value) && oneOf(PLAYER_MEASUREMENT_MODES)(value.mode) && oneOf(PLAYER_UNIT_TYPES)(value.unitType)
    && inRange(SCENE_RANGES.unitDistance)(value.unitDistance) && oneOf(PLAYER_DIAGONAL_RULES)(value.diagonalRule)
    && Array.isArray(value.rangeBands) && value.rangeBands.length <= SCENE_LIMITS.rangeBands
    && value.rangeBands.every((band) => isRangeBand(band))
    // An older GM sends no snap flag and no cone angle; the mirror fills them in.
    && (!Object.hasOwn(value, 'snapToGrid') || isBoolean(value.snapToGrid))
    && (!Object.hasOwn(value, 'coneAngle') || isConeAngle(value.coneAngle))
    // An older GM sends no snap grid; the players then snap to the grid they see.
    && optional(nullable(isSnapGrid))(value.snapGrid);
}

const FIELD_CHECKS: Record<SceneFieldKey, Check> = {
  map: isPlayerMap,
  grid: nullable(isPlayerGrid),
  widgets: isPlayerWidgets,
  initiative: nullable(isPlayerInitiative),
  measurement: isPlayerMeasurement,
};
const RECORD_CHECKS: Record<SceneRecordKey, Check> = {
  tokens: isPlayerToken,
  fog: isPlayerFogOp,
  texts: isPlayerText,
  drawings: isPlayerDrawing,
};

/** A snapshot's scene: fog and drawings come in their own parts. */
export function isPlayerSceneBody(value: unknown): boolean {
  return isFields(value) && isSceneId(value.sceneId)
    // An older GM sends no measurement; the mirror fills it in.
    && SCENE_FIELD_KEYS.every((key) => (Object.hasOwn(value, key) ? FIELD_CHECKS[key](value[key]) : key === 'measurement'))
    && isRecordOf(value.tokens, isPlayerToken) && isRecordOf(value.texts, isPlayerText);
}

export function isFogRecords(value: unknown): boolean {
  return isRecordOf(value, isPlayerFogOp);
}

export function isDrawingRecords(value: unknown): boolean {
  return isRecordOf(value, isPlayerDrawing);
}

/** `set`, `upsert` and `remove` of a patch; fields a newer GM adds are ignored, not refused. */
export function isScenePatchBody(message: Fields): boolean {
  const { set, upsert, remove } = message;
  if (!isFields(set) || !isFields(upsert) || !isFields(remove)) return false;
  return SCENE_FIELD_KEYS.every((key) => !Object.hasOwn(set, key) || FIELD_CHECKS[key](set[key]))
    && SCENE_RECORD_KEYS.every((key) => !Object.hasOwn(upsert, key) || isRecordOf(upsert[key], RECORD_CHECKS[key]))
    && SCENE_RECORD_KEYS.every((key) => !Object.hasOwn(remove, key) || isIdList(remove[key]));
}
