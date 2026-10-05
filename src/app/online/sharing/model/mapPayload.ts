/**
 * A shared map on the wire. Player-safe: the scene as online players get it (`PlayerScene`)
 * plus visible pins with ticked notes. Full: the map file with images and ticked notes as
 * references and every other path cleared. Validated like received scenes.
 */
import { isAssetId } from '../../assets/assetIds';
import { isDrawingRecords, isFogRecords, isPlayerSceneBody, isSceneId } from '../../scene/sceneValidation';
import { SCENE_LIMITS } from '../../scene/sceneLimits';
import type { PlayerScene } from '../../scene/sceneTypes';
import { isMapFileBody } from './sharedMapFile';

export const MAP_PAYLOAD_FORMAT = 'atlas-share-map-v1';
export const IMAGE_REF_PREFIX = 'atlas-share-image:';
export const NOTE_REF_PREFIX = 'atlas-share-note:';

export interface SharedPin {
  x: number;
  y: number;
  /** The ticked note's item id. */
  note: string;
  icon?: string;
  label?: string;
  hex?: boolean;
}

export interface PlayerSafeMapPayload {
  format: typeof MAP_PAYLOAD_FORMAT;
  mode: 'player-safe';
  name: string;
  scene: PlayerScene;
  pins: SharedPin[];
  /** Token id → item id of its ticked note. */
  tokenNotes: Record<string, string>;
  /** Item ids of every ticked note. */
  notes: string[];
  /** Fingerprints of the images the scene shows. */
  images: string[];
}

export interface FullMapPayload {
  format: typeof MAP_PAYLOAD_FORMAT;
  mode: 'full';
  name: string;
  map: Record<string, unknown>;
  notes: string[];
  images: string[];
}

export type MapPayload = PlayerSafeMapPayload | FullMapPayload;

const ITEM_ID = /^[A-Za-z0-9_-]{22}$/;
const isItemId = (value: unknown): value is string => typeof value === 'string' && ITEM_ID.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const ids = (value: unknown, valid: (item: unknown) => boolean): value is string[] =>
  Array.isArray(value) && value.length <= SCENE_LIMITS.records && value.every(valid);

function isPin(value: unknown): value is SharedPin {
  if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !isItemId(value.note)) return false;
  return (value.icon === undefined || (typeof value.icon === 'string' && value.icon.length <= 64))
    && (value.label === undefined || (typeof value.label === 'string' && value.label.length <= 64))
    && (value.hex === undefined || value.hex === true);
}

export function parseMapPayload(value: unknown): MapPayload | null {
  if (!isRecord(value) || value.format !== MAP_PAYLOAD_FORMAT || !isName(value.name)) return null;
  if (!ids(value.notes, isItemId) || !ids(value.images, isAssetId)) return null;
  if (value.mode === 'player-safe') {
    const scene = value.scene;
    if (!isRecord(scene) || !isPlayerSceneBody(scene) || !isFogRecords(scene.fog) || !isDrawingRecords(scene.drawings)) return null;
    if (!ids(value.pins, isPin) || !isRecord(value.tokenNotes)) return null;
    if (!Object.entries(value.tokenNotes).every(([id, note]) => isSceneId(id) && isItemId(note))) return null;
    return value as unknown as PlayerSafeMapPayload;
  }
  if (value.mode === 'full') return isRecord(value.map) && isMapFileBody(value.map) ? (value as unknown as FullMapPayload) : null;
  return null;
}
