/**
 * A three-way merge of lines. Lines unchanged on both sides anchor the texts; between two
 * anchors a region changed on one side only takes that side, a region changed alike on both
 * takes it once, and a region changed differently is a conflict for the receiver to settle.
 */
import { commonLines } from './diffLines';

export type MergeChunk =
  | { kind: 'same'; lines: string[] }
  | { kind: 'mine' | 'theirs' | 'both'; lines: string[]; base: string[] }
  | { kind: 'conflict'; base: string[]; mine: string[]; theirs: string[] };

/** Lines as `join('\n')` gives them back, a trailing newline included. */
export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((line, index) => line === b[index]);

/** The pairs of lines that match; `aligned` goes false when the diff gave up on this pair of texts. */
function matches(base: readonly string[], other: readonly string[], aligned: { value: boolean }): Map<number, number> {
  const pairs = commonLines(base, other);
  if (pairs === null) aligned.value = false;
  return new Map(pairs ?? []);
}

export function diff3(base: string, mine: string, theirs: string): MergeChunk[] {
  return diff3Checked(base, mine, theirs).chunks;
}

/** `aligned` is false when a diff gave up (too different or too long): the chunks are then not a real merge, and must never be saved unseen. */
export function diff3Checked(base: string, mine: string, theirs: string): { chunks: MergeChunk[]; aligned: boolean } {
  const b = splitLines(base);
  const a = splitLines(mine);
  const c = splitLines(theirs);
  const aligned = { value: true };
  const toMine = matches(b, a, aligned);
  const toTheirs = matches(b, c, aligned);
  const chunks: MergeChunk[] = [];
  const push = (chunk: MergeChunk): void => {
    const last = chunks[chunks.length - 1];
    if (chunk.kind === 'same' && last?.kind === 'same') last.lines.push(...chunk.lines);
    else chunks.push(chunk);
  };
  let i = 0;
  let ia = 0;
  let ic = 0;
  const region = (bEnd: number, aEnd: number, cEnd: number): void => {
    const bb = b.slice(i, bEnd);
    const aa = a.slice(ia, aEnd);
    const cc = c.slice(ic, cEnd);
    if (bb.length === 0 && aa.length === 0 && cc.length === 0) return;
    if (same(aa, bb) && same(cc, bb)) push({ kind: 'same', lines: bb });
    else if (same(aa, bb)) push({ kind: 'theirs', lines: cc, base: bb });
    else if (same(cc, bb)) push({ kind: 'mine', lines: aa, base: bb });
    else if (same(aa, cc)) push({ kind: 'both', lines: aa, base: bb });
    else push({ kind: 'conflict', base: bb, mine: aa, theirs: cc });
  };
  for (let k = 0; k < b.length; k++) {
    const ka = toMine.get(k);
    const kc = toTheirs.get(k);
    if (ka === undefined || kc === undefined || ka < ia || kc < ic) continue;
    region(k, ka, kc);
    push({ kind: 'same', lines: [b[k]!] });
    i = k + 1;
    ia = ka + 1;
    ic = kc + 1;
  }
  region(b.length, a.length, c.length);
  return { chunks, aligned: aligned.value };
}
