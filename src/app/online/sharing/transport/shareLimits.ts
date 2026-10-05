/** Limits of sharing between Obsidian clients, as images have theirs. */
import { ASSET_LIMITS } from '../../assets/assetIds';
import { IMAGE_HANDLE_MAX, MAX_HANDLE } from '../../assets/assetProtocol';
import type { ShareKind } from './shareProtocol';

const MiB = 1024 * 1024;

export const SHARE_LIMITS = {
  noteBytes: 2 * MiB,
  mapBytes: 16 * MiB,
  imageBytes: ASSET_LIMITS.fileBytes,
  /** Longest share message (a full catalogue list fits). */
  messageBytes: 256 * 1024,
  catalogueItems: 500,
  /** A sender keeps at most this much of a transfer unacknowledged, so no hop holds more. */
  windowBytes: MiB,
  /** A receiver acknowledges every this many bytes, and at the end. */
  ackEveryBytes: 256 * 1024,
  /** The GM cancels a relayed transfer whose receiver's channel holds more than this. */
  relayBufferBytes: 2 * MiB,
  chunkBytes: ASSET_LIMITS.sentChunkBytes,
  incomingPerPeer: 4,
  queuedPerPeer: 16,
  /** Transfers one player may have open through the GM's relay at once. */
  relayedPerSender: 8,
  requestsPerSecond: 10,
  requestTimeoutMs: 15_000,
  stallMs: 60_000,
} as const;

/** The lowest handle sharing uses: every share chunk is at or above it, every image chunk below. */
export const SHARE_HANDLE_MIN = IMAGE_HANDLE_MAX + 1;

export interface HandleRange {
  min: number;
  max: number;
}

/** Handles a node (the GM's own, or a player's) gives its outgoing transfers. */
export const NODE_HANDLES: HandleRange = { min: SHARE_HANDLE_MIN, max: 0xbfff_ffff };
/** Handles the GM's relay gives the transfers it forwards: never a node's, so a cancel's direction is known by its handle. */
export const RELAY_HANDLES: HandleRange = { min: NODE_HANDLES.max + 1, max: MAX_HANDLE };

export function maxShareBytes(kind: ShareKind): number {
  return kind === 'note' ? SHARE_LIMITS.noteBytes : kind === 'map' ? SHARE_LIMITS.mapBytes : SHARE_LIMITS.imageBytes;
}
