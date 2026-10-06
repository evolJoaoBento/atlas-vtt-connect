/**
 * Serves the images of the scene players have over each player's assets
 * channel. A `GmSession` handler, like `SceneHub`: requests come only
 * from admitted players, only fingerprints of the current projection are
 * served, one image at a time per player (map first), in chunks paced on the
 * channel's buffer so scene updates on the control channel are never starved.
 */
import type { SessionHandler, SessionPlayer } from '../gmSessionTypes';
import type { AssetFile } from '../scene/sceneContracts';
import type { PlayerScene } from '../scene/sceneTypes';
import type { ChannelPort } from '../transport/types';
import { ASSET_LIMITS, sceneAssetIds } from './assetIds';
import { decodeAsset, encodeAsset, encodeChunk, IMAGE_HANDLE_MAX } from './assetProtocol';
import { SharedReads } from './SharedReads';

export interface AssetServerOptions {
  session: {
    use(handler: SessionHandler): () => void;
    assetChannel(playerId: string): ChannelPort | null;
  };
  /** The scene players have (the scene hub). */
  projection: {
    currentProjection(): PlayerScene | null;
    onProjection(listener: (scene: PlayerScene | null) => void): () => void;
  };
  /** Verified file reads (the registry): null when a file cannot be served. */
  files: { read(id: string): Promise<AssetFile | null> };
}

interface Transfer {
  id: string;
  handle: number;
  /** Null while the file is read. */
  file: AssetFile | null;
  offset: number;
}

interface PlayerQueue {
  port: ChannelPort;
  pending: string[];
  current: Transfer | null;
  nextHandle: number;
  /** Set while sending, so a request that arrives meanwhile only queues… */
  pumping: boolean;
  /** …and sets this, so the sending goes round once more. */
  again: boolean;
  stops: Array<() => void>;
}

export class AssetServer implements SessionHandler {
  private readonly queues = new Map<string, PlayerQueue>();
  private readonly reads: SharedReads;
  private readonly stops: Array<() => void> = [];
  private allowed = new Set<string>();
  private mapId: string | null = null;

  constructor(private readonly options: AssetServerOptions) {
    this.reads = new SharedReads((id) => options.files.read(id));
  }

  start(): void {
    const { session, projection } = this.options;
    this.projectionChanged(projection.currentProjection());
    this.stops.push(session.use(this), projection.onProjection((scene) => this.projectionChanged(scene)));
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
    for (const playerId of [...this.queues.keys()]) this.drop(playerId);
    this.reads.clear();
  }

  onGone(player: SessionPlayer): void {
    this.drop(player.playerId);
  }

  onAssetData(player: SessionPlayer, data: unknown): void {
    const decoded = decodeAsset(data);
    if (decoded.kind !== 'message') return;
    const { message } = decoded;
    if (message.type === 'asset-request') this.request(player.playerId, message.ids);
    else if (message.type === 'asset-cancel') this.cancel(player.playerId, message.ids);
  }

  private request(playerId: string, ids: readonly string[]): void {
    const queue = this.queueOf(playerId);
    if (!queue) return;
    for (const id of ids) {
      if (queue.current?.id === id || queue.pending.includes(id)) continue;
      const full = queue.pending.length + (queue.current ? 1 : 0) >= ASSET_LIMITS.pendingPerPlayer;
      if (full || !this.allowed.has(id)) {
        queue.port.send(encodeAsset({ v: 1, type: 'asset-denied', id }));
        continue;
      }
      if (id === this.mapId) queue.pending.unshift(id);
      else queue.pending.push(id);
    }
    this.pump(playerId, queue);
  }

  private cancel(playerId: string, ids: readonly string[]): void {
    const queue = this.queues.get(playerId);
    if (!queue) return;
    this.remove(queue, new Set(ids), false);
    this.pump(playerId, queue);
  }

  private projectionChanged(scene: PlayerScene | null): void {
    this.allowed = new Set(sceneAssetIds(scene));
    this.mapId = scene?.map.asset ?? null;
    for (const [playerId, queue] of [...this.queues]) {
      const held = queue.current ? [queue.current.id, ...queue.pending] : queue.pending;
      const gone = new Set(held.filter((id) => !this.allowed.has(id)));
      if (gone.size > 0) this.remove(queue, gone, true);
      const at = this.mapId === null ? -1 : queue.pending.indexOf(this.mapId);
      if (at > 0) queue.pending.unshift(...queue.pending.splice(at, 1));
      if (gone.size > 0 || at > 0) this.pump(playerId, queue);
    }
  }

  /** Takes `ids` out of a queue; a transfer in flight stops, with `asset-denied` when it left the scene. */
  private remove(queue: PlayerQueue, ids: ReadonlySet<string>, deny: boolean): void {
    queue.pending = queue.pending.filter((id) => !ids.has(id));
    const current = queue.current;
    if (!current || !ids.has(current.id)) return;
    this.finish(queue, current);
    if (deny) queue.port.send(encodeAsset({ v: 1, type: 'asset-denied', id: current.id }));
  }

  private queueOf(playerId: string): PlayerQueue | null {
    const existing = this.queues.get(playerId);
    if (existing) return existing;
    const port = this.options.session.assetChannel(playerId);
    if (!port) return null;
    const queue: PlayerQueue = { port, pending: [], current: null, nextHandle: 1, pumping: false, again: false, stops: [] };
    queue.stops.push(
      port.onClose(() => { if (this.queues.get(playerId) === queue) this.drop(playerId); }),
      port.onDrain(ASSET_LIMITS.lowWaterBytes, () => this.pump(playerId, queue)),
    );
    this.queues.set(playerId, queue);
    return queue;
  }

  private drop(playerId: string): void {
    const queue = this.queues.get(playerId);
    if (!queue) return;
    this.queues.delete(playerId);
    queue.stops.forEach((stop) => stop());
    if (queue.current) this.reads.release(queue.current.id);
    queue.pending = [];
    queue.current = null;
  }

  /** Sends what the channel takes now; runs again when a read finishes or the buffer drains. */
  private pump(playerId: string, queue: PlayerQueue): void {
    if (this.queues.get(playerId) !== queue) return;
    if (queue.pumping) {
      // A synchronous reply (a cancel and a new request) arrived while sending: go round once more.
      queue.again = true;
      return;
    }
    queue.pumping = true;
    try {
      do {
        queue.again = false;
        let more = true;
        while (more) more = this.sendSome(playerId, queue);
      } while (queue.again && this.queues.get(playerId) === queue);
    } finally {
      queue.pumping = false;
    }
  }

  /** One step: start the next image, or send chunks of the current one. True when the next image can start now. */
  private sendSome(playerId: string, queue: PlayerQueue): boolean {
    const transfer = queue.current;
    if (!transfer) {
      const id = queue.pending.shift();
      if (id === undefined) return false;
      const next: Transfer = { id, handle: queue.nextHandle, file: null, offset: 0 };
      queue.nextHandle = queue.nextHandle >= IMAGE_HANDLE_MAX ? 1 : queue.nextHandle + 1;
      queue.current = next;
      this.reads.hold(id); // bytes are kept only while a transfer sends them
      void this.reads.file(id).then((file) => this.fileRead(playerId, queue, next, file));
      return false;
    }
    if (!transfer.file) return false;
    const bytes = new Uint8Array(transfer.file.bytes);
    while (transfer.offset < bytes.byteLength && queue.port.bufferedAmount() < ASSET_LIMITS.highWaterBytes) {
      const end = Math.min(transfer.offset + ASSET_LIMITS.sentChunkBytes, bytes.byteLength);
      queue.port.send(encodeChunk(transfer.handle, bytes.subarray(transfer.offset, end)));
      transfer.offset = end;
      if (queue.current !== transfer) return false; // cancelled while sending
    }
    if (transfer.offset < bytes.byteLength) return false; // waits for the drain
    queue.port.send(encodeAsset({ v: 1, type: 'asset-end', handle: transfer.handle }));
    this.finish(queue, transfer);
    return true;
  }

  private fileRead(playerId: string, queue: PlayerQueue, transfer: Transfer, file: AssetFile | null): void {
    if (queue.current !== transfer || this.queues.get(playerId) !== queue) return;
    if (!file || file.bytes.byteLength === 0) {
      this.finish(queue, transfer);
      queue.port.send(encodeAsset({ v: 1, type: 'asset-denied', id: transfer.id }));
    } else {
      transfer.file = file;
      queue.port.send(encodeAsset({
        v: 1, type: 'asset-start', id: transfer.id, handle: transfer.handle, size: file.bytes.byteLength, mime: file.mime,
      }));
    }
    this.pump(playerId, queue);
  }

  private finish(queue: PlayerQueue, transfer: Transfer): void {
    if (queue.current !== transfer) return; // dropped meanwhile: its hold is released already
    queue.current = null;
    this.reads.release(transfer.id);
  }
}
