/**
 * Checks for the board messages (`boardTypes.ts`). Shared with the web player page, so it imports only wire files.
 * Ids that assignment treats specially are refused, as for the scene.
 */
import { BOARD_PART_LIMITS, type BoardCamera, type BoardExtras } from './boardTypes';
import { isSceneId } from './sceneValidation';

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= BOARD_PART_LIMITS.text;
const isNullable = (check: (value: unknown) => boolean) => (value: unknown): boolean => value === null || check(value);
const isPoint = (value: unknown): boolean => isFields(value) && isNumber(value.x) && isNumber(value.y);
const isPoint3 = (value: unknown): boolean => isPoint(value) && isNumber((value as Fields).z);
const isList = (value: unknown, max: number, item: (entry: unknown) => boolean): boolean =>
  Array.isArray(value) && value.length <= max && value.every(item);

function isDoor(value: unknown): boolean {
  return isFields(value) && typeof value.open === 'boolean' && (value.swing === 'left' || value.swing === 'right')
    && isNullable(isSceneId)(value.prop) && (value.chainId === undefined || isText(value.chainId));
}

function isWall(value: unknown): boolean {
  if (!isFields(value) || !isSceneId(value.id) || (value.type !== 'solid' && value.type !== 'door')) return false;
  if (!isPoint(value.p1) || !isPoint(value.p2) || !isNullable(isNumber)(value.height) || !isNullable(isSceneId)(value.material)) return false;
  return value.type === 'door' ? isDoor(value.door) : value.door === undefined;
}

function isLight(value: unknown): boolean {
  return isFields(value) && isSceneId(value.id) && isNumber(value.x) && isNumber(value.y) && isNullable(isNumber)(value.height)
    && isText(value.color) && isNumber(value.bright) && isNumber(value.dim) && isNumber(value.intensity)
    && isNullable(isText)(value.animation) && isNullable(isNumber)(value.angle) && isNumber(value.rotation);
}

function isProp(value: unknown): boolean {
  return isFields(value) && isSceneId(value.id) && isSceneId(value.asset) && isNumber(value.x) && isNumber(value.y)
    && isNumber(value.scale) && isNumber(value.turn);
}

function isMaterial(value: unknown): boolean {
  if (!isFields(value) || !isSceneId(value.id) || !isNumber(value.scale) || !isFields(value.maps)) return false;
  const maps = Object.entries(value.maps);
  return maps.length <= BOARD_PART_LIMITS.maps && maps.every(([role, id]) => isSceneId(role) && isSceneId(id));
}

/** One part of a scene's board extras. */
export function isBoardExtras(value: unknown): value is BoardExtras {
  if (!isFields(value) || !isSceneId(value.sceneId)) return false;
  const lighting = value.lighting;
  return isList(value.walls, BOARD_PART_LIMITS.walls, isWall) && isList(value.lights, BOARD_PART_LIMITS.lights, isLight)
    && isList(value.props, BOARD_PART_LIMITS.props, isProp) && isList(value.materials, BOARD_PART_LIMITS.materials, isMaterial)
    && isNullable(isNumber)(value.ambient) && isNullable(isNumber)(value.fogHeight)
    && isFields(lighting) && typeof lighting.enabled === 'boolean' && isNumber(lighting.ambient) && isNullable(isText)(lighting.ambientColor);
}

export function isBoardCamera(value: unknown): value is BoardCamera {
  return isFields(value) && isSceneId(value.sceneId) && isPoint3(value.eye) && isPoint3(value.target);
}

/** A `board-extras` message's numbering: part `part` of `parts`, all of one `seq`. */
export function isBoardPart(message: Fields): boolean {
  return Number.isSafeInteger(message.seq) && (message.seq as number) >= 1
    && Number.isSafeInteger(message.parts) && (message.parts as number) >= 1 && (message.parts as number) <= BOARD_PART_LIMITS.parts
    && Number.isSafeInteger(message.part) && (message.part as number) >= 0 && (message.part as number) < (message.parts as number);
}
