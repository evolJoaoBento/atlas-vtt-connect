/**
 * Sends items in chunks, never more than `windowBytes` ahead of the receiver's last
 * acknowledgement (the last chunk is cut to fit), so neither this side nor a relaying GM ever holds
 * more of a transfer. A send that gets no acknowledgement for `stallMs` is cancelled. Sending is
 * re-entrant-safe: an acknowledgement that arrives while chunks go out (in-memory links answer at
 * once) only marks another round.
 */
import { encodeChunk } from '../../assets/assetProtocol';
import type { SharePayload } from '../model/SenderCatalogue';
import { NODE_HANDLES, SHARE_LIMITS, type HandleRange } from './shareLimits';
import { encodeShare } from './shareProtocol';

type Send = (to: string, data: string | ArrayBuffer) => void;

interface Outgoing {
  to: string;
  handle: number;
  bytes: Uint8Array;
  offset: number;
  acked: number;
  pumping: boolean;
  again: boolean;
  timer: number | null;
  finish: () => void;
}

export class OutgoingTransfers {
  private readonly open = new Map<number, Outgoing>();
  private nextHandle: number;

  /**
   * `self`: this side's person id, the `from` of every message it sends. Handles come from `range`,
   * from a random start so two sides' counters never meet.
   */
  constructor(private readonly sendTo: Send, private readonly self: string, private readonly range: HandleRange = NODE_HANDLES) {
    this.nextHandle = range.min + Math.floor(Math.random() * (range.max - range.min + 1));
  }

  /** Starts sending; settles when the item went out whole, was cancelled or its receiver left. */
  send(to: string, req: string, payload: SharePayload): Promise<void> {
    return new Promise((resolve) => {
      const transfer: Outgoing = {
        to, handle: this.allocate(), bytes: new Uint8Array(payload.bytes), offset: 0, acked: 0, pumping: false, again: false, timer: null, finish: resolve,
      };
      this.open.set(transfer.handle, transfer);
      this.sendTo(to, encodeShare({
        v: 1, type: 'share-start', to, from: this.self, req, handle: transfer.handle, size: transfer.bytes.byteLength, kind: payload.kind, version: payload.version,
        ...(payload.mime ? { mime: payload.mime } : {}),
      }));
      this.pump(transfer);
    });
  }

  ack(from: string, handle: number, received: number): void {
    const transfer = this.open.get(handle);
    if (!transfer || transfer.to !== from) return;
    const acked = Math.max(transfer.acked, Math.min(received, transfer.offset));
    if (acked === transfer.acked) return;
    transfer.acked = acked;
    this.pump(transfer);
  }

  cancel(from: string, handle: number): void {
    const transfer = this.open.get(handle);
    if (transfer && transfer.to === from) this.finish(transfer);
  }

  drop(to: string): void {
    for (const transfer of [...this.open.values()]) if (transfer.to === to) this.finish(transfer);
  }

  openCount(to: string): number {
    return [...this.open.values()].filter((transfer) => transfer.to === to).length;
  }

  stop(): void {
    for (const transfer of [...this.open.values()]) this.finish(transfer);
  }

  private allocate(): number {
    const { min, max } = this.range;
    while (this.open.has(this.nextHandle)) this.nextHandle = this.nextHandle >= max ? min : this.nextHandle + 1;
    const handle = this.nextHandle;
    this.nextHandle = handle >= max ? min : handle + 1;
    return handle;
  }

  private pump(transfer: Outgoing): void {
    if (transfer.pumping) {
      transfer.again = true;
      return;
    }
    transfer.pumping = true;
    try {
      do {
        transfer.again = false;
        const total = transfer.bytes.byteLength;
        for (;;) {
          const room = SHARE_LIMITS.windowBytes - (transfer.offset - transfer.acked);
          if (this.open.get(transfer.handle) !== transfer || transfer.offset >= total || room <= 0) break;
          const start = transfer.offset;
          transfer.offset = start + Math.min(SHARE_LIMITS.chunkBytes, total - start, room);
          this.sendTo(transfer.to, encodeChunk(transfer.handle, transfer.bytes.subarray(start, transfer.offset)));
        }
      } while (transfer.again);
      if (this.open.get(transfer.handle) !== transfer) return;
      if (transfer.offset >= transfer.bytes.byteLength) {
        this.sendTo(transfer.to, encodeShare({ v: 1, type: 'share-end', to: transfer.to, from: this.self, handle: transfer.handle }));
        this.finish(transfer);
      } else {
        this.arm(transfer);
      }
    } finally {
      transfer.pumping = false;
    }
  }

  private arm(transfer: Outgoing): void {
    if (transfer.timer !== null) window.clearTimeout(transfer.timer);
    transfer.timer = window.setTimeout(() => {
      if (this.open.get(transfer.handle) !== transfer) return;
      this.sendTo(transfer.to, encodeShare({ v: 1, type: 'share-cancel', to: transfer.to, from: this.self, handle: transfer.handle }));
      this.finish(transfer);
    }, SHARE_LIMITS.stallMs);
  }

  private finish(transfer: Outgoing): void {
    if (transfer.timer !== null) window.clearTimeout(transfer.timer);
    transfer.timer = null;
    if (this.open.get(transfer.handle) === transfer) this.open.delete(transfer.handle);
    transfer.finish();
  }
}
