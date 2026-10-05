/** A note's frontmatter, split off and reduced to the properties that may be shared. Text only, never parsed as YAML. */
import { stripCommentsChecked } from './commentFilter';
import { looksLikeTag } from './privateTags';
import { SHARE_PROPERTY } from './shareRule';

/** Frontmatter opens at the first line (after a byte order mark) and ends at the next `---`, as in Obsidian. */
export function splitFrontmatter(source: string): { frontmatter: string[] | null; body: string } {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const lines = text.split('\n');
  if (lines[0]?.trimEnd() !== '---') return { frontmatter: null, body: text };
  const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');
  if (end < 0) return { frontmatter: null, body: text };
  return { frontmatter: lines.slice(1, end), body: lines.slice(end + 1).join('\n') };
}

const TOP_LEVEL_KEY = /^("[^"]+"|'[^']+'|[^\s#:'"-][^:]*?):(?:\s|$)/;

/**
 * Comments (`%% %%`, `<!-- -->`) are removed from a kept property; one that stays open drops the whole property,
 * and so does part tag text (tags are not read in properties; old callout text counts too). Fail closed.
 */
function withoutComments(block: readonly string[]): string[] {
  if (block.some((line) => looksLikeTag(line))) return [];
  const { lines, open } = stripCommentsChecked(block);
  return open ? [] : lines;
}

/** The lines of the top-level properties named in `keep` (case-insensitive), never `atlas-share`; comments and unreadable lines go. */
export function keepProperties(lines: readonly string[], keep: readonly string[]): string[] {
  const wanted = new Set(keep.map((key) => key.trim().toLowerCase()).filter((key) => key && key !== SHARE_PROPERTY));
  const blocks: string[][] = [];
  let keeping = false;
  for (const line of lines) {
    const key = TOP_LEVEL_KEY.exec(line)?.[1];
    if (key !== undefined) {
      keeping = wanted.has(key.replace(/^["']|["']$/g, '').trim().toLowerCase());
      if (keeping) blocks.push([line]);
    } else if (/^\S/.test(line) && !/^-(\s|$)/.test(line)) {
      keeping = false; // a comment or a line we cannot read at the top level
    } else if (keeping) {
      blocks[blocks.length - 1]?.push(line);
    }
  }
  return blocks.flatMap(withoutComments);
}
