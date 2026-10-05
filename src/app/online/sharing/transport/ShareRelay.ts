/**
 * The GM forwards what one player sends another: messages with the sender stamped as `from`,
 * and transfers chunk by chunk under the relay's own handle on the receiver's hop. It holds only
 * handle mappings, never bytes: each chunk is re-framed and sent the moment it arrives, and
 * the sender's window bounds what the receiver's channel can hold. Mappings go when a transfer
 * ends, is cancelled, or either side leaves; one player has at most `relayedPerSender` open.
 * Honest senders keep to the window; one that ignores acks is stopped by the receiver's channel
 * buffer (`relayBufferBytes`, about 2 MiB plus a chunk), not by a count per mapping.
 *
 * Handles tell a cancel's direction: senders' handles are below `RELAY_HANDLES.min`, the relay's
 * own (what receivers see) at or above it, so a person who sends one transfer and receives another
 * is never taken for the wrong side.
 */
import { encodeChunk, type AssetChunk } from '../../assets/assetProtocol';
import { NODE_HANDLES, RELAY_HANDLES, SHARE_LIMITS } from './shareLimits';
import { encodeShare, type ShareMessage, type ShareStart } from './shareProtocol';

type Send = (to: string, data: string | ArrayBuffer) => void;

interface Mapping {
  sender: string;
  senderHandle: number;
  receiver: string;
  receiverHandle: number;
}

export class ShareRelay {
  private readonly bySender = new Map<string, Mapping>();
  private readonly byReceiver = new Map<string, Mapping>();
  private nextHandle = RELAY_HANDLES.min;

  constructor(private readonly sendTo: Send, private readonly buffered: (to: string) => number) {}

  /** A message from `from` for another player (`message.to`). */
  message(from: string, message: ShareMessage): void {
    switch (message.type) {
      case 'share-start':
        this.start(from, message);
        break;
      case 'share-ack': {
        const back = this.byReceiver.get(`${from}:${message.handle}`);
        if (back && back.sender === message.to) this.sendTo(back.sender, encodeShare({ ...message, from, handle: back.senderHandle }));
        break;
      }
      case 'share-cancel':
        this.cancel(from, message);
        break;
      case 'share-end': {
        const mapping = this.bySender.get(`${from}:${message.handle}`);
        if (!mapping || mapping.receiver !== message.to) break;
        this.sendTo(mapping.receiver, encodeShare({ ...message, from, handle: mapping.receiverHandle }));
        this.forget(mapping);
        break;
      }
      default:
        this.sendTo(message.to, encodeShare({ ...message, from }));
    }
  }

  /** Forwards a chunk of a relayed transfer; false when it belongs to none (the GM's own transfers). */
  chunk(from: string, chunk: AssetChunk): boolean {
    const mapping = this.bySender.get(`${from}:${chunk.handle}`);
    if (!mapping) return false;
    if (this.buffered(mapping.receiver) > SHARE_LIMITS.relayBufferBytes) {
      this.cancelBoth(mapping);
      return true;
    }
    this.sendTo(mapping.receiver, encodeChunk(mapping.receiverHandle, chunk.bytes));
    return true;
  }

  /** Turns a transfer down before it opens: the sender stops, and the receiver's request fails as busy. */
  refuse(from: string, start: ShareStart): void {
    this.cancelTo(from, start.handle, start.to);
    this.sendTo(start.to, encodeShare({ v: 1, type: 'share-denied', to: start.to, from, req: start.req, reason: 'busy' }));
  }

  /** Someone left: every transfer they were part of is cancelled for the other side. */
  gone(person: string): void {
    for (const mapping of [...this.bySender.values()]) {
      if (mapping.sender === person) this.cancelTo(mapping.receiver, mapping.receiverHandle, person);
      else if (mapping.receiver === person) this.cancelTo(mapping.sender, mapping.senderHandle, person);
      else continue;
      this.forget(mapping);
    }
  }

  mappings(): number {
    return this.bySender.size;
  }

  stop(): void {
    this.bySender.clear();
    this.byReceiver.clear();
  }

  private start(from: string, start: ShareStart): void {
    const key = `${from}:${start.handle}`;
    const open = [...this.bySender.values()].filter((mapping) => mapping.sender === from).length;
    if (start.handle > NODE_HANDLES.max || this.bySender.has(key) || open >= SHARE_LIMITS.relayedPerSender) {
      this.refuse(from, start);
      return;
    }
    const mapping: Mapping = { sender: from, senderHandle: start.handle, receiver: start.to, receiverHandle: this.allocate(start.to) };
    this.bySender.set(key, mapping);
    this.byReceiver.set(`${start.to}:${mapping.receiverHandle}`, mapping);
    this.sendTo(start.to, encodeShare({ ...start, from, handle: mapping.receiverHandle }));
  }

  /** From the receiver (it knows the relay's handle) or from the sender (its own): the handle's range says which. */
  private cancel(from: string, message: Extract<ShareMessage, { type: 'share-cancel' }>): void {
    if (message.handle >= RELAY_HANDLES.min) {
      const back = this.byReceiver.get(`${from}:${message.handle}`);
      if (!back || back.sender !== message.to) return;
      this.sendTo(back.sender, encodeShare({ ...message, from, handle: back.senderHandle }));
      this.forget(back);
      return;
    }
    const forth = this.bySender.get(`${from}:${message.handle}`);
    if (!forth || forth.receiver !== message.to) return;
    this.sendTo(forth.receiver, encodeShare({ ...message, from, handle: forth.receiverHandle }));
    this.forget(forth);
  }

  private cancelBoth(mapping: Mapping): void {
    this.cancelTo(mapping.sender, mapping.senderHandle, mapping.receiver);
    this.cancelTo(mapping.receiver, mapping.receiverHandle, mapping.sender);
    this.forget(mapping);
  }

  private cancelTo(to: string, handle: number, from: string): void {
    this.sendTo(to, encodeShare({ v: 1, type: 'share-cancel', to, from, handle }));
  }

  private forget(mapping: Mapping): void {
    this.bySender.delete(`${mapping.sender}:${mapping.senderHandle}`);
    this.byReceiver.delete(`${mapping.receiver}:${mapping.receiverHandle}`);
  }

  /** The next relay handle not in use for `receiver`. */
  private allocate(receiver: string): number {
    const { min, max } = RELAY_HANDLES;
    while (this.byReceiver.has(`${receiver}:${this.nextHandle}`)) this.nextHandle = this.nextHandle >= max ? min : this.nextHandle + 1;
    const handle = this.nextHandle;
    this.nextHandle = handle >= max ? min : handle + 1;
    return handle;
  }
}
