/**
 * The body of a note as one reader gets it: tags and comments go (`privateTags.scanMarkup`), and so does
 * every part whose tag does not let the reader in; a part nested in another must pass every rule. A part
 * that is never closed hides everything after its tag from everyone, and a malformed tag hides up to its
 * end (or the end of the note).
 *
 * Backstop: tag text that is not a tag (`[!private`, `[!only`, `[!except`, `[!public`, `[!end`: an old
 * `> [!private]` callout, a tag Atlas could not read, a tag-like comment) hides everything from it to the
 * end of the note. It is looked for in the author's view (every part shown, malformed ones too, so no tag
 * can cover it up) and once more in the reader's text.
 *
 * Restricted parts the reader gets can keep their tags, rewritten (`forwardedParts.ts`).
 */
import { keptLines, visibleView, type TextRange } from './commentFilter';
import { lenientQuote } from './quoteLines';
import type { BlockContext } from './codeContext';
import { END_TAG, looksLikeTag, pairTags, scanMarkup, TAG_MENTION, type OpenPart, type PartRule, type PartTag } from './privateTags';

/** What the sender should hear about a note's tags. */
export interface PartProblems {
  /** Starts of malformed tags. */
  malformed: string[];
  /** The body lines (1-based) of `%%[!end]%%` tags with nothing open; such a note is not shared. */
  strayEndLines: number[];
  /** Tags never closed: what follows them is hidden from everyone. */
  unclosed: number;
  /** A comment never closed (before the next tag): it hides the rest of the note. */
  unclosedComment: boolean;
  /** A tag token possibly inside code or a link: not used, and the rest of the note is kept back. */
  tagInCodeOrLink: boolean;
  /** Tag text outside a tag, which hides the rest of the note: its start, and whether it reads as an old callout. */
  strayText: { text: string; oldCallout: boolean } | null;
}

/** Rewrites the open tag of a restricted part the reader may see; its end goes as `%%[!end]%%`. */
export interface PartMarks {
  openTag(rule: PartRule): string;
}

/** The range a part covers, from its tag to its end (or the end of the body). */
const coverOf = (part: OpenPart, body: string): TextRange => ({ start: part.tag.start, end: part.close?.end ?? body.length });
const spanOf = (tag: PartTag): TextRange => ({ start: tag.start, end: tag.end });

/** Only a closed, well-formed part whose rule lets the reader in is shown. */
const shown = (part: OpenPart, allows: (rule: PartRule) => boolean): boolean =>
  part.tag.kind === 'open' && part.close !== null && allows(part.tag.rule);

/** Where tag text outside a tag starts in what `hidden` leaves of `body`, as an offset of `body`. */
function strayTagText(body: string, hidden: readonly TextRange[]): number | null {
  const view = visibleView(body, hidden);
  const match = TAG_MENTION.exec(view.text);
  return match ? view.offsets[match.index] ?? body.length : null;
}

interface Markup {
  tags: TextRange[];
  comments: TextRange[];
  parts: OpenPart[];
  /** From the author's backstop to the end, or null. */
  backstop: number | null;
}

function markupOf(body: string, blocks: BlockContext): Markup {
  const { tags, comments, suspects } = scanMarkup(body, blocks);
  const tagRanges = tags.map(spanOf);
  const commentRanges = comments.map(({ start, end }) => ({ start, end }));
  // A comment that reads as a tag is tag text outside a tag too.
  const tagLike = comments.filter((comment) => looksLikeTag(comment.content)).map((comment) => comment.start);
  const authorText = strayTagText(body, [...tagRanges, ...commentRanges]);
  const starts = [...tagLike, ...suspects.map((suspect) => suspect.start), ...(authorText === null ? [] : [authorText])];
  return { tags: tagRanges, comments: commentRanges, parts: pairTags(tags).parts, backstop: starts.length > 0 ? Math.min(...starts) : null };
}

/** Whether `text` holds exactly `count` well-formed parts, each closed, and no other tag. */
function holdsMarkedParts(text: string, count: number): boolean {
  const { tags, comments } = scanMarkup(text, 'inline-only');
  const { parts, stray } = pairTags(tags);
  return comments.length === 0 && stray.length === 0 && parts.length === count && parts.every((part) => part.tag.kind === 'open' && part.close !== null);
}

const inside = (range: TextRange, cover: TextRange): boolean => cover.start <= range.start && range.end <= cover.end;

/**
 * The body lines a reader gets. With `marks`, every restricted part they get keeps its tags (rewritten by
 * `marks`); a part whose tags do not both come through is hidden instead, so a tag never goes without its
 * end. Without `marks`, tags go like any comment.
 */
export function bodyLinesFor(body: string, allows: (rule: PartRule) => boolean, blocks: BlockContext, marks?: PartMarks): string[] {
  const markup = markupOf(body, blocks);
  const hidden = new Set(markup.parts.filter((part) => !shown(part, allows)));
  let backstop = markup.backstop;
  for (;;) {
    const covers = [...hidden].map((part) => coverOf(part, body));
    const stop: TextRange[] = backstop === null ? [] : [{ start: backstop, end: body.length }];
    const plain = [...markup.comments, ...markup.tags, ...covers, ...stop];
    const readerText = strayTagText(body, plain);
    if (readerText !== null) {
      backstop = Math.min(backstop ?? readerText, readerText);
      continue;
    }
    const blocked = [...markup.comments, ...covers, ...stop];
    const candidates = marks
      ? markup.parts.filter((part) => !hidden.has(part) && part.tag.kind === 'open' && 'names' in part.tag.rule)
      : [];
    const broken = candidates.filter((part) => [part.tag, part.close].some((tag) => !tag || blocked.some((range) => inside(spanOf(tag), range))));
    if (broken.length > 0) {
      broken.forEach((part) => hidden.add(part));
      continue;
    }
    // Public parts carry no rule of their own: their tags go like comments.
    const marked = candidates;
    const markedStarts = new Set(marked.flatMap((part) => [part.tag.start, part.close?.start]));
    const replacements: TextRange[] = marked.flatMap((part) => (part.tag.kind === 'open' && part.close
      ? [{ ...spanOf(part.tag), text: marks?.openTag(part.tag.rule) ?? '' }, { ...spanOf(part.close), text: END_TAG }]
      : []));
    const ranges = [...markup.comments, ...markup.tags.filter((tag) => !markedStarts.has(tag.start)), ...covers, ...stop, ...replacements];
    const lines = keptLines(body, ranges).filter((line): line is string => line !== null);
    // A rewritten tag that did not come through whole (or text that reads as one more) hides every marked part.
    if (marked.length === 0 || holdsMarkedParts(lines.join('\n'), marked.length)) return lines;
    marked.forEach((part) => hidden.add(part));
  }
}

const lineOf = (body: string, offset: number): number => body.slice(0, offset).split('\n').length;

export function partProblemsIn(body: string, blocks: BlockContext): PartProblems {
  const { tags, comments, suspects } = scanMarkup(body, blocks);
  const { parts, stray } = pairTags(tags);
  const { backstop } = markupOf(body, blocks);
  let strayText: PartProblems['strayText'] = null;
  if (backstop !== null && !suspects.some((suspect) => suspect.start === backstop)) {
    const lineStart = body.lastIndexOf('\n', backstop - 1) + 1;
    const line = body.slice(lineStart, body.indexOf('\n', backstop) < 0 ? body.length : body.indexOf('\n', backstop));
    const { depth, content } = lenientQuote(line);
    strayText = { text: body.slice(backstop, backstop + 30), oldCallout: depth > 0 && TAG_MENTION.exec(content)?.index === 0 };
  }
  return {
    malformed: tags.flatMap((tag) => (tag.kind === 'malformed' ? [tag.text] : [])),
    strayEndLines: stray.map((tag) => lineOf(body, tag.start)),
    unclosed: parts.filter((part) => part.close === null).length,
    unclosedComment: comments.some((comment) => !comment.closed),
    tagInCodeOrLink: suspects.length > 0,
    strayText,
  };
}

/** The names `only` and `except` tags use (only `kind`'s when given), in order of appearance. */
export function partNamesIn(body: string, kind?: 'only' | 'except'): string[] {
  return scanMarkup(body, 'inline-only').tags.flatMap((tag) => (tag.kind === 'open' && 'names' in tag.rule && (!kind || tag.rule.kind === kind) ? tag.rule.names : []));
}
