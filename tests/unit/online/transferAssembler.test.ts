import { describe, expect, it } from 'vitest';
import { ASSET_LIMITS } from '../../../src/app/online/assets/assetIds';
import type { AssetChunk } from '../../../src/app/online/assets/assetProtocol';
import { TransferAssembler } from '../../../src/app/online/assets/TransferAssembler';
import { fingerprint as fp } from './sceneFixtures';

const A = fp(1);
const B = fp(2);
const chunk = (handle: number, bytes: number[]): AssetChunk => ({ handle, bytes: new Uint8Array(bytes) });

describe('TransferAssembler', () => {
  it('assembles a transfer from its chunks', () => {
    const assembler = new TransferAssembler();
    expect(assembler.start(A, 7, 5, 'image/png')).toBe(true);
    expect(assembler.chunk(chunk(7, [1, 2, 3]))).toEqual({ kind: 'added', id: A });
    expect(assembler.received(A)).toBe(3);
    assembler.chunk(chunk(7, [4, 5]));
    const ended = assembler.end(7);
    expect(ended?.id).toBe(A);
    expect(ended?.mime).toBe('image/png');
    expect([...new Uint8Array(ended?.bytes ?? new ArrayBuffer(0))]).toEqual([1, 2, 3, 4, 5]);
    expect(assembler.isOpen(A)).toBe(false);
    expect(assembler.end(7)).toBeNull();
  });

  it('never goes past the announced size, and reports a short transfer', () => {
    const assembler = new TransferAssembler();
    assembler.start(A, 1, 4, 'image/png');
    assembler.chunk(chunk(1, [1, 2, 3]));
    expect(assembler.chunk(chunk(1, [4, 5]))).toEqual({ kind: 'overflow', id: A });
    expect(assembler.isOpen(A)).toBe(false);
    expect(assembler.chunk(chunk(1, [6]))).toEqual({ kind: 'ignored' });

    assembler.start(B, 2, 4, 'image/gif');
    assembler.chunk(chunk(2, [1]));
    expect(assembler.end(2)).toEqual({ id: B, mime: 'image/gif', bytes: null });
  });

  it('ignores chunks and ends of transfers it was not told about', () => {
    const assembler = new TransferAssembler();
    expect(assembler.chunk(chunk(9, [1]))).toEqual({ kind: 'ignored' });
    expect(assembler.end(9)).toBeNull();
    expect(assembler.received(A)).toBe(0);
  });

  it('opens at most 16 transfers, one per handle and image, of at most 64 MB', () => {
    const assembler = new TransferAssembler();
    for (let index = 1; index <= ASSET_LIMITS.openTransfers; index++) expect(assembler.start(fp(index), index, 1, 'image/png')).toBe(true);
    expect(assembler.start(fp(99), 99, 1, 'image/png')).toBe(false);
    assembler.clear();
    expect(assembler.start(A, 1, ASSET_LIMITS.fileBytes + 1, 'image/png')).toBe(false);
    expect(assembler.start(A, 1, ASSET_LIMITS.fileBytes, 'image/png')).toBe(true);
    expect(assembler.start(B, 1, 1, 'image/png')).toBe(false); // handle in use
    expect(assembler.start(A, 2, 1, 'image/png')).toBe(false); // image already coming
    assembler.drop(A);
    expect(assembler.start(A, 2, 1, 'image/png')).toBe(true);
  });

  it('refuses sizes and handles that cannot be real', () => {
    const assembler = new TransferAssembler();
    for (const size of [0, -1, 1.5, Number.NaN, Infinity]) expect(assembler.start(A, 1, size, 'image/png')).toBe(false);
    for (const handle of [0, -1, 1.5, 0x1_0000_0000]) expect(assembler.start(A, handle, 1, 'image/png')).toBe(false);
    expect(assembler.isOpen(A)).toBe(false);
  });
});
