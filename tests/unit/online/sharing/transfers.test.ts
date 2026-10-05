import { afterEach, describe, expect, it, vi } from 'vitest';
import { IncomingTransfers, type IncomingOutcome } from '../../../../src/app/online/sharing/transport/IncomingTransfers';
import { OutgoingTransfers } from '../../../../src/app/online/sharing/transport/OutgoingTransfers';
import { SHARE_LIMITS } from '../../../../src/app/online/sharing/transport/shareLimits';
import { decodeShare } from '../../../../src/app/online/sharing/transport/shareProtocol';

const VERSION = 'V'.repeat(43);
const REQ = 'r'.repeat(11);

/** A sender to `ana` and her receiver, wired back to back: what the sender sends waits in `wire` until delivered. */
function pair() {
  const wire: Array<string | ArrayBuffer> = [];
  const outcomes: Array<[string, IncomingOutcome]> = [];
  // What the sender has put on the wire minus what the receiver last acknowledged: the sender's own offset - acked.
  let sent = 0;
  let acked = 0;
  let maxUnacked = 0;
  const outgoing = new OutgoingTransfers((_to, data) => {
    if (typeof data !== 'string') { sent += data.byteLength - 4; maxUnacked = Math.max(maxUnacked, sent - acked); }
    wire.push(data);
  }, 'gm');
  const incoming = new IncomingTransfers({
    self: 'ana',
    send: (_to, data) => {
      const decoded = decodeShare(data);
      if (decoded.kind === 'message' && decoded.message.type === 'share-ack') {
        acked = decoded.message.received;
        outgoing.ack('ana', decoded.message.handle, decoded.message.received);
      } else wire.push(data);
    },
    done: (req, outcome) => outcomes.push([req, outcome]),
    progress: () => {},
  });
  const deliver = (): void => {
    while (wire.length > 0) {
      const decoded = decodeShare(wire.shift()!);
      if (decoded.kind === 'chunk') incoming.chunk('hop', decoded.chunk);
      else if (decoded.kind === 'message' && decoded.message.type === 'share-start') incoming.start('hop', 'gm', decoded.message);
      else if (decoded.kind === 'message' && decoded.message.type === 'share-end') incoming.end('hop', decoded.message.handle);
    }
  };
  return { wire, outcomes, outgoing, incoming, deliver, maxUnacked: () => maxUnacked, sent: () => sent };
}

afterEach(() => { vi.useRealTimers(); });

describe('windowed transfers', () => {
  it('send a large item within the window and assemble it whole', async () => {
    const { outgoing, outcomes, deliver, maxUnacked } = pair();
    const bytes = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
    const sent = outgoing.send('ana', REQ, { kind: 'map', bytes: bytes.buffer, version: VERSION });
    deliver();
    await sent;
    expect(maxUnacked()).toBeLessThanOrEqual(SHARE_LIMITS.windowBytes);
    const [req, outcome] = outcomes[0]!;
    expect(req).toBe(REQ);
    // `toEqual` on millions of elements is far too slow: compare the bytes natively.
    expect(outcome.ok && Buffer.from(outcome.item.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(outgoing.openCount('ana')).toBe(0);
  });

  it('cut the last chunk to the room left, so unacked bytes never pass the window', () => {
    const { outgoing, wire, sent } = pair();
    void outgoing.send('ana', REQ, { kind: 'map', bytes: new ArrayBuffer(3 * 1024 * 1024), version: VERSION });
    expect(sent()).toBe(SHARE_LIMITS.windowBytes);
    const start = decodeShare(wire[0]!);
    const handle = start.kind === 'message' && start.message.type === 'share-start' ? start.message.handle : 0;
    // An acknowledgement that is not a multiple of the chunk size leaves a gap smaller than a chunk.
    outgoing.ack('ana', handle, 1000);
    // Exactly the room: a whole chunk would have put unacked bytes at windowBytes + chunk - 1000.
    expect(sent() - 1000).toBe(SHARE_LIMITS.windowBytes);
  });

  it('send an empty item: a start and an end', async () => {
    const { outgoing, outcomes, deliver } = pair();
    const sent = outgoing.send('ana', REQ, { kind: 'note', bytes: new ArrayBuffer(0), version: VERSION });
    deliver();
    await sent;
    expect(outcomes[0]![1]).toMatchObject({ ok: true, item: { kind: 'note', version: VERSION } });
  });

  it('fail a transfer that ends short or overflows', () => {
    const { incoming, outcomes } = pair();
    incoming.start('hop', 'gm', { v: 1, type: 'share-start', to: 'ana', req: REQ, handle: 0x8000_0001, size: 4, kind: 'note', version: VERSION });
    incoming.end('hop', 0x8000_0001);
    expect(outcomes[0]![1]).toEqual({ ok: false, reason: 'failed' });
    incoming.start('hop', 'gm', { v: 1, type: 'share-start', to: 'ana', req: 'q'.repeat(11), handle: 0x8000_0002, size: 2, kind: 'note', version: VERSION });
    incoming.chunk('hop', { handle: 0x8000_0002, bytes: new Uint8Array([1, 2, 3]) });
    expect(outcomes[1]![1]).toEqual({ ok: false, reason: 'too-large' });
  });

  it('cancel a send that gets no acknowledgement for a minute', () => {
    vi.useFakeTimers();
    const { outgoing, wire } = pair();
    void outgoing.send('ana', REQ, { kind: 'map', bytes: new ArrayBuffer(2 * 1024 * 1024), version: VERSION });
    vi.advanceTimersByTime(SHARE_LIMITS.stallMs);
    const last = decodeShare(wire.at(-1)!);
    expect(last.kind === 'message' && last.message.type).toBe('share-cancel');
    expect(outgoing.openCount('ana')).toBe(0);
  });
});
