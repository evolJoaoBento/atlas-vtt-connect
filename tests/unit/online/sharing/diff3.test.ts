import { describe, expect, it } from 'vitest';
import { commonLines } from '../../../../src/app/online/sharing/merge/diffLines';
import { diff3 } from '../../../../src/app/online/sharing/merge/diff3';
import { conflictCount, mergedText } from '../../../../src/app/online/sharing/merge/mergeResult';

describe('line diff', () => {
  it('finds a longest common subsequence', () => {
    expect(commonLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])).toEqual([[0, 0], [2, 2], [3, 3]]);
    expect(commonLines([], ['a'])).toEqual([]);
    expect(commonLines(['a', 'b'], ['a', 'b'])).toEqual([[0, 0], [1, 1]]);
    expect(commonLines(['x'], ['y'])).toEqual([]);
  });

  it('gives up on texts too different to align, and the merge is then one conflict', () => {
    const a = Array.from({ length: 2100 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 2100 }, (_, i) => `b${i}`);
    expect(commonLines(a, b)).toBeNull();
    expect(conflictCount(diff3('x', a.join('\n'), b.join('\n')))).toBe(1);
  });
});

describe('three-way merge', () => {
  const base = 'a\nb\nc\nd\ne';

  it('takes one-sided changes on both sides automatically', () => {
    const chunks = diff3(base, 'a\nB\nc\nd\ne', 'a\nb\nc\nD\ne');
    expect(conflictCount(chunks)).toBe(0);
    expect(mergedText(chunks, [], 'both')).toBe('a\nB\nc\nD\ne');
  });

  it('treats the same change on both sides as no conflict', () => {
    const chunks = diff3(base, 'a\nX\nc\nd\ne', 'a\nX\nc\nd\ne');
    expect(conflictCount(chunks)).toBe(0);
    expect(mergedText(chunks, [], 'both')).toBe('a\nX\nc\nd\ne');
  });

  it('offers keep mine, take theirs or keep both for a conflict', () => {
    const chunks = diff3(base, 'a\nmine\nc\nd\ne', 'a\ntheirs\nc\nd\ne');
    expect(conflictCount(chunks)).toBe(1);
    expect(chunks.find((chunk) => chunk.kind === 'conflict')).toEqual({ kind: 'conflict', base: ['b'], mine: ['mine'], theirs: ['theirs'] });
    expect(mergedText(chunks, ['mine'], 'both')).toBe('a\nmine\nc\nd\ne');
    expect(mergedText(chunks, ['theirs'], 'both')).toBe('a\ntheirs\nc\nd\ne');
    expect(mergedText(chunks, [], 'both')).toBe('a\nmine\ntheirs\nc\nd\ne');
  });

  it('keeps additions at either end and a trailing newline', () => {
    expect(mergedText(diff3('a\nb\n', 'top\na\nb\n', 'a\nb\nend\n'), [], 'both')).toBe('top\na\nb\nend\n');
    expect(mergedText(diff3('', 'mine', ''), [], 'both')).toBe('mine');
  });
});
