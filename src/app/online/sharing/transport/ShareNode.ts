/**
 * One Atlas's sharing endpoint in a session. It answers list and pull requests from its
 * catalogue for the person who asked (whom the GM vouches for), one transfer at a time per
 * person, rate-limited; it asks others for lists and items and checks every item against its
 * version (the SHA-256 of its bytes) before handing it over; push requests only reach
 * `onPush`. Every message it sends carries its own person id as `from`; the GM replaces that
 * with the sender it knows for anything a player sends.
 */
import type { AssetChunk } from '../../assets/assetProtocol';
import { sha256Id, type Hasher } from '../../assets/assetIds';
import { randomId } from '../../ids';
import { RateLimit } from '../../rateLimit';
import type { CatalogueItem, SharePayload } from '../model/SenderCatalogue';
import { IncomingTransfers, type IncomingOutcome, type PulledItem } from './IncomingTransfers';
import { OutgoingTransfers } from './OutgoingTransfers';
import { maxShareBytes, SHARE_LIMITS } from './shareLimits';
import { encodeShare, type ShareDenyReason, type ShareKind, type ShareMessage } from './shareProtocol';

export type { PulledItem } from './IncomingTransfers';

export class ShareError extends Error {
  constructor(readonly reason: ShareDenyReason | 'timeout') {
    super(`Sharing: ${reason}`);
  }
}

export interface PushRequestBody {
  item: string;
  kind: 'note' | 'map';
  title: string;
}

/** What a person (by person id) may list and open here. */
export interface NodeCatalogue {
  list(person: string): Promise<CatalogueItem[]>;
  open(person: string, ref: string): Promise<SharePayload | null>;
}

export interface ShareNodeOptions {
  /** This Atlas's person id in the session (`gm` for the GM). */
  self: string;
  catalogue: NodeCatalogue;
  /** Sends to a person: on a player always through the GM; on the GM through that player's channel. */
  send(to: string, data: string | ArrayBuffer): void;
  onPush?(from: string, push: PushRequestBody): void;
  hash?: Hasher;
}

type Pending =
  | { kind: 'list'; to: string; timer: number; resolve(items: CatalogueItem[]): void; reject(error: ShareError): void }
  | {
    kind: 'pull'; to: string; expect: ShareKind;
    /** The version asked for (the listed one, or an image's fingerprint): what the bytes must be. */
    wanted: string | undefined;
    /** The transfer this pull opened, as this side sees it; one per pull. */
    transfer: { hop: string; handle: number } | null;
    timer: number; resolve(item: PulledItem): void; reject(error: ShareError): void;
  };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Routed = ShareMessage & { from: string };

export class ShareNode {
  private readonly pending = new Map<string, Pending>();
  private readonly outgoing: OutgoingTransfers;
  private readonly incoming: IncomingTransfers;
  private readonly limit = new RateLimit(SHARE_LIMITS.requestsPerSecond);
  private readonly queues = new Map<string, { tail: Promise<void>; size: number }>();
  private readonly hash: Hasher;
  private stopped = false;

  constructor(private readonly options: ShareNodeOptions) {
    this.hash = options.hash ?? sha256Id;
    this.outgoing = new OutgoingTransfers((to, data) => options.send(to, data), options.self);
    this.incoming = new IncomingTransfers({
      self: options.self,
      send: (to, data) => options.send(to, data),
      done: (req, outcome) => { void this.settle(req, outcome); },
      progress: (req) => this.touch(req, SHARE_LIMITS.stallMs),
    });
  }

  requestList(to: string): Promise<CatalogueItem[]> {
    return new Promise((resolve, reject) => {
      const req = this.open({ kind: 'list', to, resolve, reject });
      this.sendMessage({ v: 1, type: 'share-list-request', to, req });
    });
  }

  /**
   * Pulls an item. The bytes must be the `version` the caller listed (an image's is in its ref);
   * without one, only that they match what the sender announced.
   */
  pull(to: string, item: string, expect: ShareKind, version?: string): Promise<PulledItem> {
    return new Promise((resolve, reject) => {
      const wanted = item.includes('/') ? item.slice(item.indexOf('/') + 1) : version;
      const req = this.open({ kind: 'pull', to, expect, wanted, transfer: null, resolve, reject });
      this.sendMessage({ v: 1, type: 'share-pull', to, req, item });
    });
  }

  /** Asks someone to pull an item; it only shows them a prompt. */
  push(to: string, item: string, kind: 'note' | 'map', title: string): void {
    this.sendMessage({ v: 1, type: 'share-push', to, item, kind, title });
  }

  receive(hop: string, message: Routed): void {
    if (this.stopped) return;
    const from = message.from;
    switch (message.type) {
      case 'share-list-request':
        void this.answerList(from, message.req);
        break;
      case 'share-pull':
        this.queuePull(from, message.req, message.item);
        break;
      case 'share-push':
        if (this.limit.allow(from, Date.now())) this.options.onPush?.(from, { item: message.item, kind: message.kind, title: message.title });
        break;
      case 'share-list': {
        const pending = this.pending.get(message.req);
        if (pending?.kind === 'list' && pending.to === from) {
          this.forget(message.req);
          pending.resolve(message.items);
        }
        break;
      }
      case 'share-start': {
        const pending = this.pending.get(message.req);
        const asked = pending?.kind === 'pull' && pending.to === from && pending.expect === message.kind && pending.transfer === null;
        if (asked && pending.wanted !== undefined && pending.wanted !== message.version) {
          // Not what was asked for, whatever its bytes hash to.
          this.forget(message.req);
          pending.reject(new ShareError('failed'));
        }
        if (asked && this.pending.get(message.req) === pending && this.incoming.start(hop, from, message)) {
          pending.transfer = { hop, handle: message.handle };
          this.touch(message.req, SHARE_LIMITS.stallMs);
        } else {
          this.sendMessage({ v: 1, type: 'share-cancel', to: from, handle: message.handle });
        }
        break;
      }
      case 'share-ack':
        this.outgoing.ack(from, message.handle, message.received);
        break;
      case 'share-end':
        this.incoming.end(hop, message.handle);
        break;
      case 'share-cancel':
        // Handles of the two directions come from different counters; each side only ends a transfer of this peer's.
        this.outgoing.cancel(from, message.handle);
        this.incoming.cancel(hop, from, message.handle);
        break;
      case 'share-denied': {
        const pending = this.pending.get(message.req);
        if (pending && pending.to === from) this.end(message.req, pending, new ShareError(message.reason));
        break;
      }
    }
  }

  chunk(hop: string, chunk: AssetChunk): void {
    if (!this.stopped) this.incoming.chunk(hop, chunk);
  }

  /** Someone left: their requests here stop, and what this side waits for from them fails. */
  peerGone(person: string): void {
    this.outgoing.drop(person);
    this.incoming.dropFrom(person);
    this.queues.delete(person);
    for (const [req, pending] of [...this.pending]) {
      if (pending.to !== person) continue;
      this.forget(req);
      pending.reject(new ShareError('gone'));
    }
  }

  /** This side lost its link: everything in flight fails. */
  disconnected(): void {
    this.outgoing.stop();
    this.incoming.dropFrom(null);
    this.queues.clear();
    for (const [req, pending] of [...this.pending]) {
      this.forget(req);
      pending.reject(new ShareError('gone'));
    }
  }

  stop(): void {
    this.disconnected();
    this.stopped = true;
  }

  private sendMessage(message: ShareMessage): void {
    this.options.send(message.to, encodeShare({ ...message, from: this.options.self }));
  }

  private open(pending: DistributiveOmit<Pending, 'timer'>): string {
    const req = randomId(8);
    if (this.stopped) {
      queueMicrotask(() => pending.reject(new ShareError('gone')));
      return req;
    }
    this.pending.set(req, { ...pending, timer: 0 });
    this.touch(req, SHARE_LIMITS.requestTimeoutMs);
    return req;
  }

  private touch(req: string, ms: number): void {
    const pending = this.pending.get(req);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending.timer = window.setTimeout(() => {
      if (this.pending.get(req) === pending) this.end(req, pending, new ShareError('timeout'));
    }, ms);
  }

  /** A request ends in failure. A pull whose transfer had started closes it and tells the sender to stop (a relay forgets its mapping then). */
  private end(req: string, pending: Pending, error: ShareError): void {
    this.forget(req);
    if (pending.kind === 'pull' && pending.transfer) {
      this.incoming.release(pending.transfer.hop, pending.transfer.handle);
      this.sendMessage({ v: 1, type: 'share-cancel', to: pending.to, handle: pending.transfer.handle });
    }
    pending.reject(error);
  }

  private forget(req: string): void {
    const pending = this.pending.get(req);
    if (pending) window.clearTimeout(pending.timer);
    this.pending.delete(req);
  }

  private async settle(req: string, outcome: IncomingOutcome): Promise<void> {
    const pending = this.pending.get(req);
    if (pending?.kind !== 'pull') return;
    this.forget(req);
    if (!outcome.ok) {
      pending.reject(new ShareError(outcome.reason));
      return;
    }
    const matches = (await this.hash(outcome.item.bytes)) === outcome.item.version;
    if (matches) pending.resolve(outcome.item);
    else pending.reject(new ShareError('failed'));
  }

  private deny(to: string, req: string, reason: ShareDenyReason): void {
    this.sendMessage({ v: 1, type: 'share-denied', to, req, reason });
  }

  private async answerList(from: string, req: string): Promise<void> {
    if (!this.limit.allow(from, Date.now())) {
      this.deny(from, req, 'busy');
      return;
    }
    const items = await this.options.catalogue.list(from).catch((): CatalogueItem[] => []);
    if (this.stopped) return;
    const list = items.slice(0, SHARE_LIMITS.catalogueItems);
    // Keep the answer inside one message: drop items from the end until it fits.
    let message = encodeShare({ v: 1, type: 'share-list', to: from, from: this.options.self, req, items: list });
    while (message.length > SHARE_LIMITS.messageBytes && list.length > 0) {
      list.pop();
      message = encodeShare({ v: 1, type: 'share-list', to: from, from: this.options.self, req, items: list });
    }
    this.options.send(from, message);
  }

  private queuePull(from: string, req: string, item: string): void {
    const queue = this.queues.get(from) ?? { tail: Promise.resolve(), size: 0 };
    // A map's images (`<map>/<fingerprint>`) come one after another with it: the queue bounds them, not the rate.
    const limited = !item.includes('/') && !this.limit.allow(from, Date.now());
    if (limited || queue.size >= SHARE_LIMITS.queuedPerPeer) {
      this.deny(from, req, 'busy');
      return;
    }
    queue.size++;
    queue.tail = queue.tail.then(() => this.serve(queue, from, req, item)).catch(() => undefined).finally(() => { queue.size--; });
    this.queues.set(from, queue);
  }

  /** One item to one person; the next waits until this one went out, was cancelled or they left. */
  private async serve(queue: object, from: string, req: string, item: string): Promise<void> {
    const payload = await this.options.catalogue.open(from, item).catch(() => null);
    // A queue dropped when the person left is not the one a rejoined person has.
    if (this.stopped || this.queues.get(from) !== queue) return;
    if (!payload) {
      this.deny(from, req, 'not-shared');
      return;
    }
    if (payload.bytes.byteLength > maxShareBytes(payload.kind)) {
      this.deny(from, req, 'too-large');
      return;
    }
    await this.outgoing.send(from, req, payload);
  }
}
