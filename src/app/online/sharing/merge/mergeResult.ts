/** The text of a merge: chunks as they are, each conflict as chosen (or the fallback): mine, theirs, or both (mine first). */
import type { MergeChunk } from './diff3';

export type ConflictChoice = 'mine' | 'theirs' | 'both';

export function conflictCount(chunks: readonly MergeChunk[]): number {
  return chunks.filter((chunk) => chunk.kind === 'conflict').length;
}

export function mergedText(chunks: readonly MergeChunk[], choices: ReadonlyArray<ConflictChoice | undefined>, fallback: ConflictChoice): string {
  const lines: string[] = [];
  let conflict = 0;
  for (const chunk of chunks) {
    if (chunk.kind !== 'conflict') {
      lines.push(...chunk.lines);
      continue;
    }
    const choice = choices[conflict++] ?? fallback;
    if (choice !== 'theirs') lines.push(...chunk.mine);
    if (choice !== 'mine') lines.push(...chunk.theirs);
  }
  return lines.join('\n');
}
