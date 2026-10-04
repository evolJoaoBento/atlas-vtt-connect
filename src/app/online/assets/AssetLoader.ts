/**
 * The player's side of image delivery, shared with the web player page (no
 * Obsidian imports). It follows the scene: images this device has come from
 * the cache, the rest are requested from the GM (at most 256 outstanding, 64
 * per message) and assembled from chunks. Every image is checked against its
 * fingerprint before it is decoded and shown; images the scene stops using
 * are cancelled and released.
 */
import type { PlayerAssetHandler } from '../PlayerSession';
import type { PlayerScene } from '../scene/sceneTypes';
import type { AssetCache } from './AssetCache';
import { ASSET_LIMITS, sceneAssetIds, sha256Id, type AssetMime, type Hasher } from './assetIds';
import { decodeAsset, encodeAsset, type AssetChunk, type AssetMessage } from './assetProtocol';
import { ProgressTally, type AssetProgress, type PendingImage } from './ProgressTally';
import { TransferAssembler } from './TransferAssembler';

export type { AssetProgress };

export interface DecodedImage {
  image: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  release(): void;
}

export type ImageDecoder = (bytes: ArrayBuffer, mime: AssetMime) => Promise<DecodedImage | null>;

export interface AssetLoaderOptions {
  cache: Pick<AssetCache, 'get' | 'put'>;
  decode: ImageDecoder;
  /** SHA-256 as an asset id; tests driven by fake timers pass one that resolves at once. */
  hash?: Hasher;
  /** Images or progress changed: redraw. */
  onChange(): void;
}

/** `refused`: denied, broken twice or undecodable; not asked for again while it stays in the scene. */
type Phase = 'checking' | 'waiting' | 'requested' | 'loading' | 'ready' | 'refused';

interface Wanted {
  phase: Phase;
  retried: boolean;
  /** Announced by `asset-start`; null until then. */
  size: number | null;
  image: DecodedImage | null;
}

type Outcome = 'shown' | 'mismatch' | 'undecodable' | 'gone';

export class AssetLoader implements PlayerAssetHandler {
  private readonly wanted = new Map<string, Wanted>();
  private readonly assembler = new TransferAssembler();
  private readonly hash: Hasher;
  private send: ((data: string) => void) | null = null;
  private readonly tally = new ProgressTally();
  /** Images this link was told to stop sending: a denial for one of them can be stale. */
  private readonly cancelled = new Set<string>();
  private disposed = false;
  constructor(private readonly options: AssetLoaderOptions) {
    this.hash = options.hash ?? sha256Id;
  }

  /** The decoded image for a fingerprint, once it is ready. */
  image(id: string | null): DecodedImage | null {
    return id === null ? null : this.wanted.get(id)?.image ?? null;
  }

  progress(): AssetProgress {
    const pending: PendingImage[] = [];
    for (const [id, wanted] of this.wanted) {
      if (wanted.phase === 'waiting' || wanted.phase === 'requested') pending.push({ received: this.assembler.received(id), size: wanted.size });
    }
    return this.tally.progress(pending);
  }

  setScene(scene: PlayerScene | null): void {
    if (this.disposed) return;
    const ids = sceneAssetIds(scene);
    const keep = new Set(ids);
    const cancelled: string[] = [];
    for (const [id, wanted] of [...this.wanted]) {
      if (keep.has(id)) continue;
      this.wanted.delete(id);
      this.tally.forget(id);
      this.assembler.drop(id);
      wanted.image?.release();
      if (wanted.phase === 'requested') cancelled.push(id);
    }
    this.sendIds('asset-cancel', cancelled);
    const added = ids.filter((id) => !this.wanted.has(id));
    if (added.length > 0) void this.lookUp(added);
    this.changed();
  }

  connected(send: (data: string) => void): void {
    if (this.send === send) return; // the same link again: nothing to start over
    this.send = send;
    this.restart();
    this.requestMissing();
    this.changed();
  }

  disconnected(): void {
    this.send = null;
    this.restart();
    this.changed();
  }

  receive(data: unknown): void {
    if (this.disposed || !this.send) return;
    const decoded = decodeAsset(data);
    if (decoded.kind === 'chunk') this.chunk(decoded.chunk);
    else if (decoded.kind === 'message') this.message(decoded.message);
  }

  dispose(): void {
    this.disposed = true;
    this.send = null;
    for (const wanted of this.wanted.values()) wanted.image?.release();
    this.wanted.clear();
    this.assembler.clear();
  }

  /** New images: from the cache when this device has them, the others requested together. */
  private async lookUp(ids: readonly string[]): Promise<void> {
    const entries = ids.map((id): [string, Wanted] => [id, { phase: 'checking', retried: false, size: null, image: null }]);
    for (const [id, wanted] of entries) this.wanted.set(id, wanted);
    const cached = await Promise.all(entries.map(([id]) => this.options.cache.get(id).catch(() => null)));
    entries.forEach(([id, wanted], index) => {
      const image = cached[index];
      if (!this.isCurrent(id, wanted)) return;
      if (!image) {
        wanted.phase = 'waiting';
        return;
      }
      void this.accept(id, wanted, image.bytes, image.mime, false).then((outcome) => {
        if (outcome === 'undecodable') this.refuse(id, wanted);
        else if (outcome === 'mismatch') this.retry(id, wanted);
      });
    });
    this.requestMissing();
    this.changed();
  }

  /** Checks bytes against their fingerprint, then decodes them; the GM's images are kept once they decode. */
  private async accept(id: string, wanted: Wanted, bytes: ArrayBuffer, mime: AssetMime, fromGm: boolean): Promise<Outcome> {
    wanted.phase = 'loading';
    const matches = await this.hash(bytes).then((hash) => hash === id, () => false);
    if (!this.isCurrent(id, wanted)) return 'gone';
    if (!matches) return 'mismatch';
    const decoded = await this.options.decode(bytes, mime).catch(() => null);
    if (!this.isCurrent(id, wanted)) {
      decoded?.release();
      return 'gone';
    }
    if (!decoded) return 'undecodable';
    wanted.image = decoded;
    wanted.phase = 'ready';
    if (fromGm) void this.options.cache.put({ id, mime, bytes }).catch(() => undefined);
    this.changed();
    return 'shown';
  }

  private message(message: AssetMessage): void {
    if (message.type === 'asset-start') this.started(message.id, message.handle, message.size, message.mime);
    else if (message.type === 'asset-end') this.ended(message.handle);
    else if (message.type === 'asset-denied') this.denied(message.id);
  }

  private started(id: string, handle: number, size: number, mime: AssetMime): void {
    const wanted = this.wanted.get(id);
    if (!wanted || wanted.phase !== 'requested') {
      this.sendIds('asset-cancel', [id]); // not wanted any more: stop the upload
      return;
    }
    if (!this.assembler.start(id, handle, size, mime)) {
      this.failed(id, wanted);
      return;
    }
    wanted.size = size;
    this.changed();
  }

  private chunk(chunk: AssetChunk): void {
    const result = this.assembler.chunk(chunk);
    if (result.kind === 'overflow') {
      const wanted = this.wanted.get(result.id);
      if (wanted) this.failed(result.id, wanted);
    } else if (result.kind === 'added') {
      this.changed();
    }
  }

  private ended(handle: number): void {
    const ended = this.assembler.end(handle);
    const wanted = ended ? this.wanted.get(ended.id) : undefined;
    if (!ended || !wanted || wanted.phase !== 'requested') return;
    const { id, mime, bytes } = ended;
    if (!bytes) {
      this.failed(id, wanted);
      return;
    }
    this.tally.add(id, bytes.byteLength);
    void this.accept(id, wanted, bytes, mime, true).then((outcome) => {
      if (outcome === 'mismatch') this.failed(id, wanted);
      else if (outcome === 'undecodable') this.refuse(id, wanted);
    });
    // `accept` moved it out of `requested`: a slot is free.
    this.requestMissing();
    this.changed();
  }

  private denied(id: string): void {
    const wanted = this.wanted.get(id);
    if (wanted?.phase !== 'requested') return;
    // A denial that queued up behind chunks of an earlier request: ask once more; the GM dedups, and denies again if it means it.
    if (this.cancelled.delete(id)) this.sendIds('asset-request', [id]);
    else this.refuse(id, wanted);
  }

  /** A transfer that broke its announcement or its fingerprint: cancelled, then asked for once more. */
  private failed(id: string, wanted: Wanted): void {
    if (!this.isCurrent(id, wanted)) return;
    this.assembler.drop(id);
    if (wanted.retried) {
      this.refuse(id, wanted);
      return;
    }
    // The GM may still be sending the broken transfer.
    this.sendIds('asset-cancel', [id]);
    this.retry(id, wanted);
  }

  private retry(id: string, wanted: Wanted): void {
    if (!this.isCurrent(id, wanted)) return;
    wanted.retried = true;
    wanted.phase = 'waiting';
    this.uncount(id, wanted);
    this.requestMissing();
    this.changed();
  }

  private refuse(id: string, wanted: Wanted): void {
    if (!this.isCurrent(id, wanted)) return;
    this.assembler.drop(id);
    wanted.phase = 'refused';
    this.uncount(id, wanted);
    this.requestMissing();
    this.changed();
  }

  private uncount(id: string, wanted: Wanted): void {
    this.tally.take(id);
    wanted.size = null;
  }

  /** A new link, or none: transfers of the old one are gone, and what was requested must be asked for again. */
  private restart(): void {
    this.assembler.clear();
    this.tally.reset(); // the bar starts over with the new link
    this.cancelled.clear();
    for (const wanted of this.wanted.values()) {
      if (wanted.phase !== 'requested') continue;
      wanted.phase = 'waiting';
      wanted.size = null;
    }
  }

  private requestMissing(): void {
    if (!this.send || this.disposed) return;
    let outstanding = 0;
    const waiting: Array<[string, Wanted]> = [];
    for (const entry of this.wanted) {
      if (entry[1].phase === 'requested') outstanding++;
      else if (entry[1].phase === 'waiting') waiting.push(entry);
    }
    const batch = waiting.slice(0, Math.max(0, ASSET_LIMITS.pendingPerPlayer - outstanding));
    for (const [, wanted] of batch) wanted.phase = 'requested';
    this.sendIds('asset-request', batch.map(([id]) => id));
  }

  private sendIds(type: 'asset-request' | 'asset-cancel', ids: readonly string[]): void {
    const send = this.send;
    if (!send) return;
    if (type === 'asset-cancel') ids.forEach((id) => this.cancelled.add(id));
    for (let start = 0; start < ids.length; start += ASSET_LIMITS.idsPerMessage) {
      send(encodeAsset({ v: 1, type, ids: ids.slice(start, start + ASSET_LIMITS.idsPerMessage) }));
    }
  }

  private isCurrent(id: string, wanted: Wanted): boolean {
    return !this.disposed && this.wanted.get(id) === wanted;
  }

  private changed(): void {
    if (this.progress().outstanding === 0) this.tally.reset();
    this.options.onChange();
  }
}
