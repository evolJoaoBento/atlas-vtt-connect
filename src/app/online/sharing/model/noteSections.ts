/**
 * Block context from Obsidian's own parser: `metadataCache.getFileCache(file).sections`, the note's top-level
 * blocks with their `type` and position. A part tag counts only inside a text block (`TEXT_SECTIONS`); in any
 * other block (code, math, html, table, a footnote, …) or between blocks Obsidian shows it as text, so it is
 * not a tag and the filter keeps the rest of the note back. Sections that are missing, or that do not match
 * the text being filtered (stale cache), give no text blocks at all, so every tag is kept back that way.
 *
 * Sections are top-level only: code nested in a list or quote is part of the list or quote section, so those
 * container blocks get a blunt extra check in `codeContext.ts`.
 */

/** A position in a note as Obsidian gives it: 0-based line, column, and offset from the start of the file. */
export interface NoteLoc {
  line: number;
  col: number;
  offset: number;
}

/** The part of Obsidian's `SectionCache` the filter reads. */
export interface NoteSection {
  type: string;
  position: { start: NoteLoc; end: NoteLoc };
}

/** A text block by lines of the text being scanned; `container` for lists, quotes and callouts. */
export interface TextBlock {
  startLine: number;
  endLine: number;
  container: boolean;
}

/** Sections Obsidian renders as text, where a tag is a tag. Everything else (code, math, html, table, yaml, footnoteDefinition, …) is not. */
export const TEXT_SECTIONS: ReadonlySet<string> = new Set(['paragraph', 'heading', 'list', 'blockquote', 'callout', 'comment']);
const CONTAINER_SECTIONS: ReadonlySet<string> = new Set(['list', 'blockquote', 'callout']);

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
}

/** Whether `loc` points at the same place by line/column and by offset in `text`. */
function matches(loc: NoteLoc, starts: readonly number[], text: string): boolean {
  const lineStart = starts[loc.line];
  return lineStart !== undefined && lineStart + loc.col === loc.offset && loc.offset <= text.length
    && (starts[loc.line + 1] === undefined || loc.offset < (starts[loc.line + 1] ?? 0));
}

/**
 * The text blocks of `source` (the note exactly as read, frontmatter and line endings included) by its lines,
 * or null when `sections` is missing or does not fit this text: every section must point at the same place
 * by line and column as by offset, lie inside the text, and come in order without overlapping.
 */
export function textBlocksOf(source: string, sections: readonly NoteSection[] | null | undefined): TextBlock[] | null {
  if (!sections) return null;
  const starts = lineStartsOf(source);
  let previousEnd = -1;
  for (const { position } of sections) {
    const { start, end } = position;
    if (!matches(start, starts, source) || !matches(end, starts, source) || start.offset < previousEnd || end.offset < start.offset) return null;
    previousEnd = end.offset;
  }
  return sections.filter((section) => TEXT_SECTIONS.has(section.type)).map((section) => ({
    startLine: section.position.start.line, endLine: section.position.end.line, container: CONTAINER_SECTIONS.has(section.type),
  }));
}

/** `blocks` shifted to a text that starts at line `firstLine` of the note (the body after its frontmatter). */
export function blocksFrom(blocks: readonly TextBlock[] | null, firstLine: number): TextBlock[] | null {
  return blocks?.map((block) => ({ ...block, startLine: block.startLine - firstLine, endLine: block.endLine - firstLine })) ?? null;
}
