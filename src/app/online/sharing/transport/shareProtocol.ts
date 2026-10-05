/**
 * Sharing's messages, on the assets channel beside images: JSON `share-*` messages addressed
 * by person id, and binary chunks (4-byte handle, then bytes) with handles at or above
 * `SHARE_HANDLE_MIN`. The GM stamps `from` on everything a player sends. Each validator returns
 * a fresh message of its named fields only. The web page and the image code ignore all of it.
 */
import { ASSET_LIMITS, isAssetId, isAssetMime, type AssetMime } from '../../assets/assetIds';
import { binaryOf, MAX_HANDLE, type AssetChunk } from '../../assets/assetProtocol';
import { isPersonId, PROTOCOL_VERSION } from '../../protocol';
import type { CatalogueItem } from '../model/SenderCatalogue';
import { maxShareBytes, SHARE_HANDLE_MIN, SHARE_LIMITS } from './shareLimits';

export type ShareKind = 'note' | 'map' | 'image';
export type ShareDenyReason = 'not-shared' | 'busy' | 'too-large' | 'gone' | 'failed';
const DENY_REASONS: readonly ShareDenyReason[] = ['not-shared', 'busy', 'too-large', 'gone', 'failed'];

interface Routed { v: 1; to: string; from?: string }

export type ShareStart = Routed & { type: 'share-start'; req: string; handle: number; size: number; kind: ShareKind; version: string; mime?: AssetMime };

export type ShareMessage =
  | (Routed & { type: 'share-list-request'; req: string })
  | (Routed & { type: 'share-list'; req: string; items: CatalogueItem[] })
  | (Routed & { type: 'share-pull'; req: string; item: string })
  | ShareStart
  | (Routed & { type: 'share-ack'; handle: number; received: number })
  | (Routed & { type: 'share-end'; handle: number })
  | (Routed & { type: 'share-cancel'; handle: number })
  | (Routed & { type: 'share-denied'; req: string; reason: ShareDenyReason })
  | (Routed & { type: 'share-push'; item: string; kind: 'note' | 'map'; title: string });

export type DecodedShare =
  | { kind: 'message'; message: ShareMessage }
  | { kind: 'chunk'; chunk: AssetChunk }
  | { kind: 'ignored' }
  | { kind: 'invalid'; reason: string };

type Fields = Record<string, unknown>;
const isRecord = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const ITEM_ID = /^[A-Za-z0-9_-]{22}$/;
export const isRequestId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{8,32}$/.test(value);
/** An item id, or `<map item>/<image fingerprint>`. */
export function isItemRef(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const [item, image, extra] = value.split('/');
  return extra === undefined && ITEM_ID.test(item ?? '') && (image === undefined || isAssetId(image));
}
const isHandle = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= SHARE_HANDLE_MIN && (value as number) <= MAX_HANDLE;
const isKind = (value: unknown): value is ShareKind => value === 'note' || value === 'map' || value === 'image';
const isTitle = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

function catalogueItem(value: unknown): CatalogueItem | null {
  if (!isRecord(value) || !isItemRef(value.item) || value.item.includes('/') || (value.kind !== 'note' && value.kind !== 'map')) return null;
  if (!isTitle(value.title) || !isAssetId(value.version) || !Number.isSafeInteger(value.size) || (value.size as number) < 0) return null;
  const item: CatalogueItem = { item: value.item, kind: value.kind, title: value.title, version: value.version, size: value.size as number };
  if (value.mode !== undefined) {
    if (value.mode !== 'player-safe' && value.mode !== 'full') return null;
    item.mode = value.mode;
  }
  if (value.linked !== undefined) {
    if (!Array.isArray(value.linked) || value.linked.length > SHARE_LIMITS.catalogueItems || !value.linked.every((id) => typeof id === 'string' && ITEM_ID.test(id))) return null;
    item.linked = [...(value.linked as string[])];
  }
  return item;
}

function routed(m: Fields): Routed | null {
  if (!isPersonId(m.to) || (m.from !== undefined && !isPersonId(m.from))) return null;
  return { v: 1, to: m.to, ...(m.from !== undefined ? { from: m.from } : {}) };
}

const VALIDATORS: Record<ShareMessage['type'], (m: Fields, r: Routed) => ShareMessage | null> = {
  'share-list-request': (m, r) => (isRequestId(m.req) ? { ...r, type: 'share-list-request', req: m.req } : null),
  'share-list': (m, r) => {
    if (!isRequestId(m.req) || !Array.isArray(m.items) || m.items.length > SHARE_LIMITS.catalogueItems) return null;
    const items = m.items.map(catalogueItem);
    return items.every((item): item is CatalogueItem => item !== null) ? { ...r, type: 'share-list', req: m.req, items } : null;
  },
  'share-pull': (m, r) => (isRequestId(m.req) && isItemRef(m.item) ? { ...r, type: 'share-pull', req: m.req, item: m.item } : null),
  'share-start': (m, r) => {
    if (!isRequestId(m.req) || !isHandle(m.handle) || !isKind(m.kind) || !isAssetId(m.version)) return null;
    if (!Number.isSafeInteger(m.size) || (m.size as number) < 0 || (m.size as number) > maxShareBytes(m.kind)) return null;
    if (m.mime !== undefined && (m.kind !== 'image' || !isAssetMime(m.mime))) return null;
    return { ...r, type: 'share-start', req: m.req, handle: m.handle, size: m.size as number, kind: m.kind, version: m.version, ...(m.mime !== undefined ? { mime: m.mime } : {}) };
  },
  'share-ack': (m, r) => (isHandle(m.handle) && Number.isSafeInteger(m.received) && (m.received as number) >= 0
    ? { ...r, type: 'share-ack', handle: m.handle, received: m.received as number } : null),
  'share-end': (m, r) => (isHandle(m.handle) ? { ...r, type: 'share-end', handle: m.handle } : null),
  'share-cancel': (m, r) => (isHandle(m.handle) ? { ...r, type: 'share-cancel', handle: m.handle } : null),
  'share-denied': (m, r) => (isRequestId(m.req) && DENY_REASONS.includes(m.reason as ShareDenyReason)
    ? { ...r, type: 'share-denied', req: m.req, reason: m.reason as ShareDenyReason } : null),
  'share-push': (m, r) => (isItemRef(m.item) && !m.item.includes('/') && (m.kind === 'note' || m.kind === 'map') && isTitle(m.title)
    ? { ...r, type: 'share-push', item: m.item, kind: m.kind, title: m.title } : null),
};

export function encodeShare(message: ShareMessage): string {
  return JSON.stringify(message);
}

export function decodeShare(raw: unknown): DecodedShare {
  if (typeof raw !== 'string') {
    const bytes = binaryOf(raw);
    if (!bytes || bytes.byteLength < 4) return { kind: 'invalid', reason: 'bad-chunk' };
    const handle = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
    if (handle < SHARE_HANDLE_MIN) return { kind: 'ignored' };
    if (bytes.byteLength === 4 || bytes.byteLength > 4 + ASSET_LIMITS.chunkBytes) return { kind: 'invalid', reason: 'bad-chunk-size' };
    return { kind: 'chunk', chunk: { handle, bytes: bytes.subarray(4) } };
  }
  if (raw.length > SHARE_LIMITS.messageBytes) return { kind: 'invalid', reason: 'too-large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'not-json' };
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string' || !parsed.type.startsWith('share-')) return { kind: 'ignored' };
  if (parsed.v !== PROTOCOL_VERSION) return { kind: 'invalid', reason: 'version' };
  const type = parsed.type as ShareMessage['type'];
  if (!Object.hasOwn(VALIDATORS, type)) return { kind: 'ignored' };
  const route = routed(parsed);
  const message = route ? VALIDATORS[type](parsed, route) : null;
  return message ? { kind: 'message', message } : { kind: 'invalid', reason: `bad-${type}` };
}
