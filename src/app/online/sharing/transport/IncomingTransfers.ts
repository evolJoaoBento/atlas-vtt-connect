/**
 * Assembles pulled items from chunks, by the hop they arrive on and their handle. Only
 * transfers this side asked for are opened (the node checks the request), never past their
 * announced size, at most `incomingPerPeer` per sender. Acknowledges every `ackEveryBytes` and
 * at the end, which is what lets the sender go on.
 */
import type { AssetChunk } from '../../assets/assetProtocol';
import type { AssetMime } from '../../assets/assetIds';
import { SHARE_LIMITS } from './shareLimits';
import { encodeShare, type ShareDenyReason, type ShareKind, type ShareStart } from './shareProtocol';

export interface PulledItem {
  kind: ShareKind;
  version: string;
  mime?: AssetMime;
  bytes: ArrayBuffer;
}

export type IncomingOutcome = { ok: true; item: PulledItem } | { ok: false; reason: ShareDenyReason };

interface Incoming {
  from: string;
  start: ShareStart;
  received: number;
  sinceAck: number;
  parts: Uint8Array[];
}

export interface IncomingOptions {
  /** This side's person id, the `from` of its acknowledgements and cancels. */
  self: string;
  send(to: string, data: string): void;
  done(req: string, outcome: IncomingOutcome): void;
  /** Bytes arrived for the request: its stall timer starts over. */
  progress(req: string): void;
}

export class IncomingTransfers {
  private readonly open = new Map<string, Incoming>();

  constructor(private readonly options: IncomingOptions) {}

  start(hop: string, from: string, start: ShareStart): boolean {
    const key = `${hop}:${start.handle}`;
    if (this.open.has(key) || [...this.open.values()].filter((incoming) => incoming.from === from).length >= SHARE_LIMITS.incomingPerPeer) return false;
    this.open.set(key, { from, start, received: 0, sinceAck: 0, parts: [] });
    return true;
  }

  chunk(hop: string, chunk: AssetChunk): void {
    const key = `${hop}:${chunk.handle}`;
    const incoming = this.open.get(key);
    if (!incoming) return;
    if (incoming.received + chunk.bytes.byteLength > incoming.start.size) {
      this.options.send(incoming.from, encodeShare({ v: 1, type: 'share-cancel', to: incoming.from, from: this.options.self, handle: chunk.handle }));
      this.close(key, incoming, { ok: false, reason: 'too-large' });
      return;
    }
    incoming.parts.push(chunk.bytes.slice());
    incoming.received += chunk.bytes.byteLength;
    incoming.sinceAck += chunk.bytes.byteLength;
    this.options.progress(incoming.start.req);
    if (incoming.sinceAck >= SHARE_LIMITS.ackEveryBytes || incoming.received === incoming.start.size) {
      incoming.sinceAck = 0;
      this.options.send(incoming.from, encodeShare({ v: 1, type: 'share-ack', to: incoming.from, from: this.options.self, handle: chunk.handle, received: incoming.received }));
    }
  }

  end(hop: string, handle: number): void {
    const key = `${hop}:${handle}`;
    const incoming = this.open.get(key);
    if (!incoming) return;
    if (incoming.received !== incoming.start.size) {
      this.close(key, incoming, { ok: false, reason: 'failed' });
      return;
    }
    const bytes = new Uint8Array(incoming.start.size);
    let offset = 0;
    for (const part of incoming.parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    const { kind, version, mime } = incoming.start;
    this.close(key, incoming, { ok: true, item: { kind, version, bytes: bytes.buffer, ...(mime ? { mime } : {}) } });
  }

  /** `from` cancels a transfer they were sending: only theirs ends. */
  cancel(hop: string, from: string, handle: number): void {
    const key = `${hop}:${handle}`;
    const incoming = this.open.get(key);
    if (incoming && incoming.from === from) this.close(key, incoming, { ok: false, reason: 'gone' });
  }

  /** Closes a transfer without an outcome: its request has already ended. */
  release(hop: string, handle: number): void {
    this.open.delete(`${hop}:${handle}`);
  }

  /** Fails every transfer from `from`, or from everyone with `null`. */
  dropFrom(from: string | null): void {
    for (const [key, incoming] of [...this.open]) if (from === null || incoming.from === from) this.close(key, incoming, { ok: false, reason: 'gone' });
  }

  stop(): void {
    this.dropFrom(null);
  }

  private close(key: string, incoming: Incoming, outcome: IncomingOutcome): void {
    this.open.delete(key);
    this.options.done(incoming.start.req, outcome);
  }
}
