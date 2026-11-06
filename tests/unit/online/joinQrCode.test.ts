import { describe, expect, it } from 'vitest';
import { qrModules } from '../../../src/app/online/gm-ui/JoinQrCode';

/** Whether the 7x7 finder pattern stands at (row, col): a dark ring, a light ring and a dark 3x3 middle. */
function finderAt(modules: boolean[][], row: number, col: number): boolean {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const ring = Math.max(Math.abs(y - 3), Math.abs(x - 3));
      if (modules[row + y]![col + x] !== (ring !== 2)) return false;
    }
  }
  return true;
}

describe('the join link as a QR code', () => {
  it('codes a join link with its three finder squares', () => {
    const link = 'https://evoljoaobento.github.io/atlas-vtt-connect/#id=atlas-1a2b3c4d5e6f7a8b9c0d&table=t-0123456789abcdef';
    const modules = qrModules(link);
    expect(modules).not.toBeNull();
    const size = modules!.length;
    expect(size).toBeGreaterThanOrEqual(21);
    expect(modules!.every((row) => row.length === size)).toBe(true);
    expect(finderAt(modules!, 0, 0)).toBe(true);
    expect(finderAt(modules!, 0, size - 7)).toBe(true);
    expect(finderAt(modules!, size - 7, 0)).toBe(true);
  });

  it('grows with a long link (relay servers in it), and gives none for one too long for any QR code', () => {
    const short = qrModules('https://example.org/#id=a')!.length;
    const long = qrModules(`https://example.org/#id=a&ice=${'x'.repeat(900)}`)!.length;
    expect(long).toBeGreaterThan(short);
    expect(qrModules(`https://example.org/#ice=${'x'.repeat(4000)}`)).toBeNull();
  });
});
