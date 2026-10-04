/**
 * The assets channel's wire format (protocol v1): JSON text messages and binary
 * chunks, each a 4-byte big-endian transfer handle and up to 64 KB of a file.
 * Shared with the web player page, so this file imports nothing from Obsidian.
 */
import { PROTOCOL_VERSION } from '../protocol';
import { ASSET_LIMITS, isArrayBuffer, isAssetId, isAssetMime, type AssetMime } from './assetIds';

export type AssetMessage =
  | { v: 1; type: 'asset-request'; ids: string[] }
  | { v: 1; type: 'asset-start'; id: string; handle: number; size: number; mime: AssetMime }
  | { v: 1; type: 'asset-end'; handle: number }
  | { v: 1; type: 'asset-denied'; id: string }
  | { v: 1; type: 'asset-cancel'; ids: string[] };

/** A binary chunk: its transfer, and its bytes (a view into the received frame). */
export interface AssetChunk {
  handle: number;
  bytes: Uint8Array;
}

export type DecodedAsset =
  | { kind: 'message'; message: AssetMessage }
  | { kind: 'chunk'; chunk: AssetChunk }
  | { kind: 'ignored' }
  | { kind: 'invalid'; reason: string };

export const MAX_HANDLE = 0xffff_ffff;
/** Image transfers use handles up to this one; sharing (Obsidian clients) uses the ones above, so the two never collide. */
export const IMAGE_HANDLE_MAX = 0x7fff_ffff;
const HANDLE_BYTES = 4;

type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isHandle(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_HANDLE;
}
function isSize(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= ASSET_LIMITS.fileBytes;
}
function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= ASSET_LIMITS.idsPerMessage
    && value.every(isAssetId) && new Set(value).size === value.length;
}

/** Each validator returns a fresh message holding only its named fields, or null. */
const VALIDATORS: Record<AssetMessage['type'], (m: Fields) => AssetMessage | null> = {
  'asset-request': (m) => (isIdList(m.ids) ? { v: 1, type: 'asset-request', ids: [...m.ids] } : null),
  'asset-start': (m) => (isAssetId(m.id) && isHandle(m.handle) && isSize(m.size) && isAssetMime(m.mime)
    ? { v: 1, type: 'asset-start', id: m.id, handle: m.handle, size: m.size, mime: m.mime }
    : null),
  'asset-end': (m) => (isHandle(m.handle) ? { v: 1, type: 'asset-end', handle: m.handle } : null),
  'asset-denied': (m) => (isAssetId(m.id) ? { v: 1, type: 'asset-denied', id: m.id } : null),
  'asset-cancel': (m) => (isIdList(m.ids) ? { v: 1, type: 'asset-cancel', ids: [...m.ids] } : null),
};

export function encodeAsset(message: AssetMessage): string {
  return JSON.stringify(message);
}

export function encodeChunk(handle: number, bytes: Uint8Array): ArrayBuffer {
  if (!isHandle(handle)) throw new RangeError('Chunk handle out of range');
  if (bytes.byteLength < 1 || bytes.byteLength > ASSET_LIMITS.chunkBytes) throw new RangeError('Chunk size out of range');
  const frame = new Uint8Array(HANDLE_BYTES + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, handle, false);
  frame.set(bytes, HANDLE_BYTES);
  return frame.buffer;
}

/** The bytes of a binary frame (an ArrayBuffer or a view of one); null for anything else. */
export function binaryOf(value: unknown): Uint8Array | null {
  if (isArrayBuffer(value)) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

export function decodeAsset(raw: unknown): DecodedAsset {
  if (typeof raw === 'string') return decodeText(raw);
  const bytes = binaryOf(raw);
  if (!bytes) return { kind: 'invalid', reason: 'not-text-or-binary' };
  if (bytes.byteLength <= HANDLE_BYTES || bytes.byteLength > HANDLE_BYTES + ASSET_LIMITS.chunkBytes) {
    return { kind: 'invalid', reason: 'bad-chunk-size' };
  }
  const handle = new DataView(bytes.buffer, bytes.byteOffset, HANDLE_BYTES).getUint32(0, false);
  if (!isHandle(handle)) return { kind: 'invalid', reason: 'bad-chunk-handle' };
  return { kind: 'chunk', chunk: { handle, bytes: bytes.subarray(HANDLE_BYTES) } };
}

function decodeText(raw: string): DecodedAsset {
  // UTF-8 takes at most 3 bytes per code unit: measure only when the string could exceed the limit.
  if (raw.length > ASSET_LIMITS.messageBytes
    || (raw.length > ASSET_LIMITS.messageBytes / 3 && new TextEncoder().encode(raw).byteLength > ASSET_LIMITS.messageBytes)) {
    return { kind: 'invalid', reason: 'too-large' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'not-json' };
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return { kind: 'invalid', reason: 'no-type' };
  if (parsed.v !== PROTOCOL_VERSION) return { kind: 'invalid', reason: 'version' };
  const type = parsed.type as AssetMessage['type'];
  if (!Object.hasOwn(VALIDATORS, type)) return { kind: 'ignored' };
  const message = VALIDATORS[type](parsed);
  return message ? { kind: 'message', message } : { kind: 'invalid', reason: `bad-${type}` };
}
