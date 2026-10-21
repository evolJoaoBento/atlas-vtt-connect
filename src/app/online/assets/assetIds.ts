/**
 * Image fingerprints and the limits of image transfers. Shared with the web
 * player page, so this file imports only the id helpers and the scene wire types.
 */
import type { BoardExtras } from '../scene/boardTypes';
import { base64Url } from '../ids';
import type { PlayerScene } from '../scene/sceneTypes';

const MB = 1024 * 1024;

export const ASSET_LIMITS = {
  /** Largest image the GM sends and a player assembles. */
  fileBytes: 64 * MB,
  /** Most file bytes a player accepts in one binary chunk, after its 4-byte handle. */
  chunkBytes: 64 * 1024,
  /** File bytes the GM puts in one chunk: with the handle, a frame is exactly 64 KiB, WebRTC's default message size. */
  sentChunkBytes: 64 * 1024 - 4,
  /** Fingerprints in one `asset-request` or `asset-cancel`. */
  idsPerMessage: 64,
  /** Fingerprints the GM keeps queued or in flight for one player; more are denied. */
  pendingPerPlayer: 256,
  /** Transfers a player assembles at once. */
  openTransfers: 16,
  /** The GM sends chunks while a player's assets channel buffers less than this… */
  highWaterBytes: 1 * MB,
  /** …and resumes when it drained to this. */
  lowWaterBytes: 256 * 1024,
  /** Longest asset text message; the longest valid one is about 3.2 KB. */
  messageBytes: 16 * 1024,
  /** What a player keeps, on their device or in memory. */
  cacheBytes: 500 * MB,
} as const;

export const ASSET_MIMES = ['image/webp', 'image/png', 'image/jpeg', 'image/gif', 'image/avif', 'image/svg+xml', 'model/gltf-binary'] as const;
export type AssetMime = typeof ASSET_MIMES[number];

/** SHA-256 of some bytes as an asset id. */
export type Hasher = (bytes: ArrayBuffer) => Promise<string>;

const MIME_BY_EXTENSION: Readonly<Record<string, AssetMime>> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  // A mini the Tabletop extension stands on a token: its bytes are kept as they are, never decoded as an image.
  glb: 'model/gltf-binary',
};

/** A fingerprint: unpadded base64url SHA-256, 43 characters. */
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isAssetId(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
}

export function isAssetMime(value: unknown): value is AssetMime {
  return typeof value === 'string' && (ASSET_MIMES as readonly string[]).includes(value);
}

/** Whether an asset is a 3D model (a mini's GLB) rather than an image. */
export function isModelMime(mime: AssetMime): boolean {
  return mime === 'model/gltf-binary';
}

/** The image type a vault path stands for, by its extension; null for anything else. */
export function mimeForPath(path: string): AssetMime | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || dot < path.lastIndexOf('/')) return null;
  const extension = path.slice(dot + 1).toLowerCase();
  return Object.hasOwn(MIME_BY_EXTENSION, extension) ? MIME_BY_EXTENSION[extension] ?? null : null;
}

const EXTENSION_BY_MIME: Readonly<Record<AssetMime, string>> = {
  'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'model/gltf-binary': 'glb',
};

/** The file extension an image type is saved under (the inverse of `mimeForPath`). */
export function extensionForMime(mime: AssetMime): string {
  return EXTENSION_BY_MIME[mime];
}

/** The fingerprint of `bytes`, with Web Crypto (Obsidian and every browser have it). */
export async function sha256Id(bytes: ArrayBuffer): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/**
 * The fingerprints a scene shows: the map's first, then the tokens' in record order (each one's art, then its mini), each once.
 * `minis: false` leaves the minis' models out, for a player view that does not draw them (the web page).
 */
export function sceneAssetIds(scene: PlayerScene | null, options: { minis?: boolean } = {}): string[] {
  if (!scene) return [];
  const ids = new Set<string>();
  if (isAssetId(scene.map.asset)) ids.add(scene.map.asset);
  for (const token of Object.values(scene.tokens)) {
    if (isAssetId(token.image)) ids.add(token.image);
    if (options.minis !== false && isAssetId(token.mini?.asset)) ids.add(token.mini.asset);
  }
  // The GM's handout reaches the players of every scene in use.
  if (isAssetId(scene.handout?.asset)) ids.add(scene.handout.asset);
  return [...ids];
}

/** The files Tabletop's 3D board shows of a scene: its materials' maps, its door props and its props, each once. */
export function boardAssetIds(board: BoardExtras | null): string[] {
  if (!board) return [];
  const ids = new Set<string>();
  for (const material of board.materials) for (const id of Object.values(material.maps)) if (isAssetId(id)) ids.add(id);
  for (const wall of board.walls) if (isAssetId(wall.door?.prop)) ids.add(wall.door.prop);
  for (const prop of board.props) if (isAssetId(prop.asset)) ids.add(prop.asset);
  return [...ids];
}

/**
 * Whether `value` is an ArrayBuffer. Never `instanceof`: buffers from another
 * realm (Web Crypto, a worker, the test environment) fail that check.
 */
export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}
