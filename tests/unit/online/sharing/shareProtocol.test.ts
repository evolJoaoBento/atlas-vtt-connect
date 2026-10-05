import { describe, expect, it } from 'vitest';
import { decodeAsset, encodeChunk } from '../../../../src/app/online/assets/assetProtocol';
import { SHARE_HANDLE_MIN, SHARE_LIMITS } from '../../../../src/app/online/sharing/transport/shareLimits';
import { decodeShare, encodeShare } from '../../../../src/app/online/sharing/transport/shareProtocol';

const ITEM = 'i'.repeat(22);
const REQ = 'r'.repeat(11);
const FP = 'F'.repeat(43);
const raw = (message: Record<string, unknown>): string => JSON.stringify({ v: 1, ...message });

describe('share messages', () => {
  it('accept well-formed requests, lists and pulls', () => {
    expect(decodeShare(raw({ type: 'share-list-request', to: 'gm', req: REQ }))).toMatchObject({ kind: 'message' });
    const item = { item: ITEM, kind: 'map', title: 'Inn', version: FP, size: 10, mode: 'player-safe', linked: [ITEM] };
    expect(decodeShare(raw({ type: 'share-list', to: 'ana', from: 'gm', req: REQ, items: [item] }))).toMatchObject({ kind: 'message' });
    expect(decodeShare(raw({ type: 'share-pull', to: 'gm', req: REQ, item: `${ITEM}/${FP}` })).kind).toBe('message');
  });

  it('refuse bad addresses, ids, items and sizes', () => {
    expect(decodeShare(raw({ type: 'share-list-request', req: REQ })).kind).toBe('invalid');
    expect(decodeShare(raw({ type: 'share-list-request', to: 'bad id', req: REQ })).kind).toBe('invalid');
    expect(decodeShare(raw({ type: 'share-pull', to: 'gm', req: REQ, item: '../notes' })).kind).toBe('invalid');
    expect(decodeShare(raw({ type: 'share-list', to: 'a', req: REQ, items: [{ item: ITEM, kind: 'pdf', title: 'x', version: FP, size: 1 }] })).kind).toBe('invalid');
    expect(decodeShare(raw({ type: 'share-start', to: 'a', req: REQ, handle: 5, size: 1, kind: 'note', version: FP })).kind).toBe('invalid');
    expect(decodeShare(raw({ type: 'share-start', to: 'a', req: REQ, handle: SHARE_HANDLE_MIN, size: SHARE_LIMITS.noteBytes + 1, kind: 'note', version: FP })).kind)
      .toBe('invalid');
    expect(decodeShare(raw({ type: 'share-start', to: 'a', req: REQ, handle: SHARE_HANDLE_MIN, size: 0, kind: 'note', version: FP })).kind).toBe('message');
    expect(decodeShare('x'.repeat(SHARE_LIMITS.messageBytes + 1))).toEqual({ kind: 'invalid', reason: 'too-large' });
  });

  it('keep share chunks and image chunks apart', () => {
    expect(decodeShare(encodeChunk(SHARE_HANDLE_MIN, new Uint8Array([1, 2])))).toMatchObject({ kind: 'chunk', chunk: { handle: SHARE_HANDLE_MIN } });
    expect(decodeShare(encodeChunk(7, new Uint8Array([1, 2])))).toEqual({ kind: 'ignored' });
    expect(decodeShare(raw({ type: 'asset-request', ids: [FP] }))).toEqual({ kind: 'ignored' });
    // The image side (and the web page) ignores share messages.
    expect(decodeAsset(encodeShare({ v: 1, type: 'share-list-request', to: 'gm', req: REQ })).kind).toBe('ignored');
  });
});
