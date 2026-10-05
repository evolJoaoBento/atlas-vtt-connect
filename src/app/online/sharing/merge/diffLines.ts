/**
 * A longest common subsequence of two line lists, by Myers' O(ND) greedy algorithm. Each
 * round's frontier is kept (only its own diagonals) to walk the path back. Past `MAX_EDITS`
 * the texts are too different (or too long) to align: null, and the merge treats them as one conflict.
 */
const MAX_EDITS = 2000;
/** Longer texts are not aligned at all: the diff runs on the UI thread, and 100k lines already take a good fraction of a second. */
export const MAX_DIFF_LINES = 100_000;

export function commonLines(a: readonly string[], b: readonly string[]): Array<[number, number]> | null {
  const n = a.length;
  const m = b.length;
  if (n > MAX_DIFF_LINES || m > MAX_DIFF_LINES) return null;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let edits = -1;
  for (let d = 0; d <= max && edits < 0; d++) {
    if (d > MAX_EDITS) return null;
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        edits = d;
        break;
      }
    }
  }
  const pairs: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = edits; d > 0; d--) {
    const frontier = trace[d]!;
    const at = (k: number): number => frontier[k + d] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      pairs.push([x - 1, y - 1]);
      x--;
      y--;
    }
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    pairs.push([x - 1, y - 1]);
    x--;
    y--;
  }
  return pairs.reverse();
}
