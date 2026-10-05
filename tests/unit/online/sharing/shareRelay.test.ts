import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { encodeChunk } from '../../../../src/app/online/assets/assetProtocol';
import { ShareRelay } from '../../../../src/app/online/sharing/transport/ShareRelay';
import { RELAY_HANDLES, SHARE_HANDLE_MIN, SHARE_LIMITS } from '../../../../src/app/online/sharing/transport/shareLimits';
import { decodeShare, type ShareMessage } from '../../../../src/app/online/sharing/transport/shareProtocol';

const REQ = 'r'.repeat(11);
const V = 'V'.repeat(43);
const H = SHARE_HANDLE_MIN + 41;

/** A garbage collector for the test: Node only hands one out when asked. */
setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as () => void;

/** Whether anything reachable from `value` is bytes. */
function holdsBytes(value: unknown, seen = new Set<unknown>()): boolean {
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  const children = value instanceof Map ? [...value.values()] : Object.values(value);
  return children.some((child) => holdsBytes(child, seen));
}

const startOf = (handle: number, to = 'ben', req = REQ): ShareMessage => ({ v: 1, type: 'share-start', to, from: 'x', req, handle, size: 3, kind: 'note', version: V });
const handleOf = (message: ShareMessage | undefined): number => (message && 'handle' in message ? message.handle : 0);

function relay(buffered = 0) {
  const sent: Array<{ to: string; data: string | ArrayBuffer }> = [];
  const decode = (index: number) => decodeShare(sent[index]!.data);
  return { sent, decode, relay: new ShareRelay((to, data) => sent.push({ to, data }), () => buffered) };
}

const start: ShareMessage = { v: 1, type: 'share-start', to: 'ben', from: 'ana', req: REQ, handle: H, size: 3, kind: 'note', version: V };

describe('ShareRelay', () => {
  it('forwards without storing: start, chunks and end with its own handle, acks mapped back', () => {
    const { sent, decode, relay: r } = relay();
    r.message('ana', start);
    const forwarded = decode(0);
    expect(sent[0]!.to).toBe('ben');
    expect(forwarded.kind === 'message' && forwarded.message).toMatchObject({ type: 'share-start', from: 'ana' });
    const handle = forwarded.kind === 'message' && forwarded.message.type === 'share-start' ? forwarded.message.handle : 0;
    expect(handle).toBeGreaterThanOrEqual(SHARE_HANDLE_MIN);
    const frame = encodeChunk(H, new Uint8Array([1, 2, 3]));
    const chunk = decodeShare(frame);
    expect(chunk.kind === 'chunk' && r.chunk('ana', chunk.chunk)).toBe(true);
    const out = decode(1);
    expect(out.kind === 'chunk' && [out.chunk.handle, [...out.chunk.bytes]]).toEqual([handle, [1, 2, 3]]);
    expect(sent[1]!.data).not.toBe(frame);
    expect(holdsBytes(r)).toBe(false);
    r.message('ben', { v: 1, type: 'share-ack', to: 'ana', from: 'ben', handle, received: 3 });
    expect(sent[2]!.to).toBe('ana');
    expect(decode(2)).toMatchObject({ kind: 'message', message: { type: 'share-ack', handle: H, from: 'ben' } });
    r.message('ana', { v: 1, type: 'share-end', to: 'ben', from: 'ana', handle: H });
    expect(decode(3)).toMatchObject({ kind: 'message', message: { type: 'share-end', handle } });
    expect(r.mappings()).toBe(0);
    expect(chunk.kind === 'chunk' && r.chunk('ana', chunk.chunk)).toBe(false);
  });

  it('retains nothing of a chunk: neither the one it got nor the frame it sent can be collected late', async () => {
    const refs: Array<WeakRef<ArrayBuffer>> = [];
    const forwarding = new ShareRelay((_to, data) => { if (typeof data !== 'string') refs.push(new WeakRef(data)); }, () => 0);
    // Built inside a function so this test keeps no reference of its own.
    const forward = (): void => {
      forwarding.message('ana', start);
      const frame = encodeChunk(H, new Uint8Array(60_000).fill(7));
      refs.push(new WeakRef(frame));
      const decoded = decodeShare(frame);
      expect(decoded.kind === 'chunk' && forwarding.chunk('ana', decoded.chunk)).toBe(true);
    };
    forward();
    expect(refs).toHaveLength(2);
    // A WeakRef keeps its target alive until the current job ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
    collect();
    expect(refs.every((ref) => ref.deref() === undefined)).toBe(true);
    expect(holdsBytes(forwarding)).toBe(false);
  });

  it('tells a sender’s cancel from a receiver’s for a person who is both', () => {
    const { sent, decode, relay: r } = relay();
    r.message('ana', startOf(SHARE_HANDLE_MIN + 1, 'ben'));
    r.message('ben', startOf(SHARE_HANDLE_MIN + 1, 'ana', 'q'.repeat(11)));
    const toBen = handleOf((decode(0) as { message: ShareMessage }).message);
    const toAna = handleOf((decode(1) as { message: ShareMessage }).message);
    expect([toBen, toAna].every((handle) => handle >= RELAY_HANDLES.min)).toBe(true);
    expect(r.mappings()).toBe(2);
    // Ana cancels what she sends (her own handle): Ben is told his handle, the transfer Ana receives stays.
    r.message('ana', { v: 1, type: 'share-cancel', to: 'ben', from: 'ana', handle: SHARE_HANDLE_MIN + 1 });
    expect(sent.at(-1)!.to).toBe('ben');
    expect(handleOf((decode(sent.length - 1) as { message: ShareMessage }).message)).toBe(toBen);
    expect(r.mappings()).toBe(1);
    // Ana cancels what she receives (the relay's handle): Ben, who sends it, is told his own.
    r.message('ana', { v: 1, type: 'share-cancel', to: 'ben', from: 'ana', handle: toAna });
    expect(sent.at(-1)!.to).toBe('ben');
    expect(handleOf((decode(sent.length - 1) as { message: ShareMessage }).message)).toBe(SHARE_HANDLE_MIN + 1);
    expect(r.mappings()).toBe(0);
  });

  it('ignores a cancel from someone who is neither side, or that names the wrong peer', () => {
    const { sent, relay: r } = relay();
    r.message('ana', startOf(SHARE_HANDLE_MIN + 1, 'ben'));
    const before = sent.length;
    r.message('cara', { v: 1, type: 'share-cancel', to: 'ben', from: 'cara', handle: SHARE_HANDLE_MIN + 1 });
    r.message('ana', { v: 1, type: 'share-cancel', to: 'cara', from: 'ana', handle: SHARE_HANDLE_MIN + 1 });
    expect(sent).toHaveLength(before);
    expect(r.mappings()).toBe(1);
  });

  it('caps open transfers per sender, and turns the extra one down on both sides', () => {
    const { sent, decode, relay: r } = relay();
    for (let index = 0; index < SHARE_LIMITS.relayedPerSender; index++) r.message('ana', startOf(SHARE_HANDLE_MIN + index, 'ben'));
    expect(r.mappings()).toBe(SHARE_LIMITS.relayedPerSender);
    const before = sent.length;
    r.message('ana', startOf(SHARE_HANDLE_MIN + 99, 'ben', 'z'.repeat(11)));
    expect(r.mappings()).toBe(SHARE_LIMITS.relayedPerSender);
    expect(sent.slice(before).map((entry) => entry.to)).toEqual(['ana', 'ben']);
    expect(decode(before)).toMatchObject({ kind: 'message', message: { type: 'share-cancel', handle: SHARE_HANDLE_MIN + 99 } });
    expect(decode(before + 1)).toMatchObject({ kind: 'message', message: { type: 'share-denied', from: 'ana', req: 'z'.repeat(11), reason: 'busy' } });
    // Another sender has room of their own, and one ending frees a place.
    r.message('cara', startOf(SHARE_HANDLE_MIN, 'ben'));
    expect(r.mappings()).toBe(SHARE_LIMITS.relayedPerSender + 1);
    r.message('ana', { v: 1, type: 'share-end', to: 'ben', from: 'ana', handle: SHARE_HANDLE_MIN });
    r.message('ana', startOf(SHARE_HANDLE_MIN + 99, 'ben'));
    expect(r.mappings()).toBe(SHARE_LIMITS.relayedPerSender + 1);
  });

  it('refuses a start that reuses an open handle or takes one from the relay’s own range', () => {
    const { sent, relay: r } = relay();
    r.message('ana', startOf(SHARE_HANDLE_MIN, 'ben'));
    r.message('ana', startOf(SHARE_HANDLE_MIN, 'ben', 'q'.repeat(11)));
    r.message('ana', startOf(RELAY_HANDLES.min, 'ben', 'w'.repeat(11)));
    expect(r.mappings()).toBe(1);
    expect(sent.filter((entry) => entry.to === 'ana')).toHaveLength(2);
  });

  it('stamps the sender on everything else', () => {
    const { decode, relay: r } = relay();
    r.message('ana', { v: 1, type: 'share-pull', to: 'ben', from: 'gm', req: REQ, item: 'i'.repeat(22) });
    expect(decode(0)).toMatchObject({ kind: 'message', message: { type: 'share-pull', from: 'ana' } });
  });

  it('cancels both sides when either goes or the receiver falls behind', () => {
    const gone = relay();
    gone.relay.message('ana', start);
    gone.relay.gone('ben');
    expect(gone.decode(1)).toMatchObject({ kind: 'message', message: { type: 'share-cancel', handle: H } });
    expect(gone.relay.mappings()).toBe(0);
    const slow = relay(8 * 1024 * 1024);
    slow.relay.message('ana', start);
    const chunk = decodeShare(encodeChunk(H, new Uint8Array([1])));
    expect(chunk.kind === 'chunk' && slow.relay.chunk('ana', chunk.chunk)).toBe(true);
    expect(slow.sent.slice(1).map((entry) => entry.to).sort()).toEqual(['ana', 'ben']);
    expect(slow.relay.mappings()).toBe(0);
  });
});
