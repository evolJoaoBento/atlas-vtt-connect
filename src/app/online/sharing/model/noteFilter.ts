/**
 * What of a note one recipient gets, decided on the sender's machine before anything is hashed or sent.
 * The part tags are read first, as whole tokens in Obsidian's text blocks (`noteSections.ts`), then comments
 * go (everywhere, code included): `%%[!private]%%` parts never, `%%[!only|names]%%` only to those people,
 * `%%[!except|names]%%` to everyone but them, each up to its `%%[!end]%%` (`privateParts.ts`). Tag text outside
 * a tag (an old `> [!private]` callout, a tag Obsidian shows as text) hides the rest of the note. Restricted
 * parts the recipient gets arrive still tagged, for the people they may pass them on to (`forwardedParts.ts`).
 * Then only shareable properties stay and links to notes the recipient does not get become text.
 */
import { partAllows, type NameResolver, type Recipient } from './audience';
import { keepProperties, splitFrontmatter } from './frontmatterFilter';
import { rewriteLinks, type LinkResolver } from './noteLinks';
import { blocksFrom, textBlocksOf, type NoteSection, type TextBlock } from './noteSections';
import { bodyLinesFor, partNamesIn, partProblemsIn, type PartMarks, type PartProblems } from './privateParts';
import { END_TAG } from './privateTags';
import { parseShareRule, SHARE_PROPERTY, unknownRuleNames } from './shareRule';

export interface NoteFilterContext {
  recipient: Recipient;
  people: NameResolver;
  /** Properties that may be shared (`online.shareableProperties`). */
  shareable: readonly string[];
  links: LinkResolver;
  /**
   * How a restricted part the recipient gets keeps its protection (`forwardedParts.ts`): its open tag as sent.
   * Null sends such parts untagged, as plain text (only for what never leaves this Atlas).
   */
  marks: PartMarks | null;
  /**
   * Obsidian's sections of the note (`metadataCache.getFileCache(file).sections`) for the same text. Missing or
   * not matching the text, no tag counts and every tag keeps the rest of the note back (`noteSections.ts`).
   */
  sections: readonly NoteSection[] | null;
}

const lf = (source: string): string => source.replace(/\r\n?/g, '\n');

interface NoteBody {
  frontmatter: string[] | null;
  body: string;
  /** Lines of the note before the body. */
  firstLine: number;
  /** Obsidian's text blocks by body line; null when the sections are missing or stale. */
  blocks: TextBlock[] | null;
}

/** The note split for filtering, with Obsidian's sections checked against `source` exactly as read. */
function noteBody(source: string, sections: readonly NoteSection[] | null | undefined): NoteBody {
  const normal = lf(source);
  const text = normal.charCodeAt(0) === 0xfeff ? normal.slice(1) : normal;
  const { frontmatter, body } = splitFrontmatter(text);
  const firstLine = text.length > body.length ? text.slice(0, text.length - body.length).split('\n').length - 1 : 0;
  return { frontmatter, body, firstLine, blocks: blocksFrom(textBlocksOf(source, sections), firstLine) };
}

export function filterNoteFor(source: string, context: NoteFilterContext): string {
  const { frontmatter, body, blocks } = noteBody(source, context.sections);
  const properties = frontmatter ? keepProperties(frontmatter, context.shareable) : [];
  const lines = bodyLinesFor(body, (rule) => partAllows(rule, context.recipient, context.people), blocks, context.marks ?? undefined);
  const head = properties.length > 0 ? `---\n${properties.join('\n')}\n---\n` : '';
  return rewriteLinks(head + lines.join('\n'), context.links);
}

/** Names in the note's tags and `atlas-share` that are not in the people list: the sender's warning. */
export function unknownNamesIn(source: string, people: NameResolver): string[] {
  const { frontmatter, body } = splitFrontmatter(lf(source));
  const names = new Set(partNamesIn(body).filter((name) => !people.byName(name) && !people.isPlaceholder?.(name)));
  const property = frontmatter?.find((line) => line.startsWith(`${SHARE_PROPERTY}:`));
  if (property) {
    const value = property.slice(SHARE_PROPERTY.length + 1).trim().replace(/^\[|\]$/g, '');
    unknownRuleNames(parseShareRule(value), people).forEach((name) => names.add(name));
  }
  return [...names].sort();
}

/** The placeholders (people added by name, not linked yet) an `except` in the note's tags or `atlas-share` names: each hides its part from everyone until linked. */
export function unlinkedExceptNames(source: string, people: NameResolver): string[] {
  const { frontmatter, body } = splitFrontmatter(lf(source));
  const names = new Set(partNamesIn(body, 'except'));
  const property = frontmatter?.find((line) => line.startsWith(`${SHARE_PROPERTY}:`));
  if (property) parseShareRule(property.slice(SHARE_PROPERTY.length + 1).trim().replace(/^\[|\]$/g, '')).except.forEach((name) => names.add(name));
  return [...names].filter((name) => !people.byName(name) && people.isPlaceholder?.(name)).sort();
}

/** Malformed, stray and unclosed tags, and tag text outside tags, for the sender's warnings; lines count from the note's first line. */
export function partProblemsInNote(source: string, sections: readonly NoteSection[] | null | undefined): PartProblems {
  const { body, firstLine, blocks } = noteBody(source, sections);
  const problems = partProblemsIn(body, blocks);
  return { ...problems, strayEndLines: problems.strayEndLines.map((line) => line + firstLine) };
}

/**
 * The line of the first `%%[!end]%%` that closes nothing, or null. Such a note is not shared at all until it
 * is fixed: its start tag was probably deleted, so the text before it may have been meant for fewer people.
 */
export function strayEndLineIn(source: string, sections: readonly NoteSection[] | null | undefined): number | null {
  return partProblemsInNote(source, sections).strayEndLines[0] ?? null;
}

export const strayEndProblem = (line: number): string =>
  `This note is not shared: the ${END_TAG} on line ${line} closes no part, so its start tag may have been deleted. Fix or remove it to share the note again.`;
