/**
 * The tags that mark parts of a note, written as Obsidian comments so they never show and never leave:
 * `%%[!private]%%`, `%%[!only|Ana, Ben]%%`, `%%[!except|Cara]%%` and `%%[!public]%%` (everyone the note is shared
 * with: no rule of its own, an outer part still applies), each closed by `%%[!end]%%`, which closes the innermost
 * open part. Keywords are case-insensitive and whitespace inside the comment is fine.
 *
 * Tags are found first, as whole tokens (`%% [!…] %%` on one line), and comments are paired only in the
 * gaps between them: a `%%` that Obsidian shows as code (`` `%%` ``) cannot shift which `%%` pairs with
 * which and so turn a part's tags into text. A comment not closed within its gap hides the rest of the note.
 * A token whose text is not a tag (an unknown keyword, no names, `end|x`) is malformed: it opens a part
 * hidden from everyone and never closes one, so a mistyped tag can only hide more.
 */
import { codeOrLinkTest, type BlockContext } from './codeContext';
import { commentScanner, type CommentSpan, type TextRange } from './commentFilter';

export type PartRule = { kind: 'private' | 'public' } | { kind: 'only' | 'except'; names: string[] };

/** A tag in a text, `[start, end)` covering the whole token. */
export type PartTag =
  | { kind: 'open'; rule: PartRule; start: number; end: number }
  | { kind: 'malformed'; text: string; start: number; end: number }
  | { kind: 'end'; start: number; end: number };

/** A part opener (a tag or a malformed one) with the end that closes it, null when nothing does. */
export interface OpenPart {
  tag: Exclude<PartTag, { kind: 'end' }>;
  close: Extract<PartTag, { kind: 'end' }> | null;
}

/** A note's tags, its comments outside them, and tag tokens possibly inside code or a link (never tags). */
export interface NoteMarkup {
  tags: PartTag[];
  comments: CommentSpan[];
  suspects: TextRange[];
}

export const END_TAG = '%%[!end]%%';
const TOKEN = /%%[ \t]*(\[[ \t]*![^\]\n]*\])[ \t]*%%/g;
const TAG = /^\[!\s*(private|public|only|except|end)\s*(?:\|([^\]]*))?\]$/i;
/** Text that reads as an attempt at a tag: it starts like one, or names a keyword after `[!`. */
const TAG_START = /^\[\s*!/;
export const TAG_MENTION = /\[\s*!\s*(?:private|only|except|public|end)/i;

/** The tag text for a rule, names as given. */
export function openTag(rule: PartRule): string {
  return 'names' in rule ? `%%[!${rule.kind}|${rule.names.join(', ')}]%%` : `%%[!${rule.kind}]%%`;
}

/** Whether text looks like a tag, or like an attempt at one. */
export function looksLikeTag(text: string): boolean {
  return TAG_START.test(text.trim()) || TAG_MENTION.test(text);
}

function tagOf(content: string, start: number, end: number): PartTag {
  const malformed: PartTag = { kind: 'malformed', text: content.slice(0, 40), start, end };
  const match = TAG.exec(content.trim());
  if (!match) return malformed;
  const kind = (match[1] ?? '').toLowerCase();
  const names = match[2];
  if (kind === 'end') return names === undefined ? { kind: 'end', start, end } : malformed;
  if (kind === 'private' || kind === 'public') return names === undefined ? { kind: 'open', rule: { kind }, start, end } : malformed;
  const list = (names ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  if (list.length === 0) return malformed;
  return { kind: 'open', rule: { kind: kind === 'only' ? 'only' : 'except', names: list }, start, end };
}

/**
 * The tags of `text` as whole tokens, then the comments in the gaps between them. `blocks` is the block context
 * (`codeContext.ts`): Obsidian's text blocks when filtering, `inline-only` where none can be known (the editor,
 * a received or merged text), null when the note's sections are missing (no token is a tag then).
 */
export function scanMarkup(text: string, blocks: BlockContext): NoteMarkup {
  const tokens = [...text.matchAll(TOKEN)].map((match) => ({ content: match[1] ?? '', start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
  // A token possibly inside code or a link shows as text in Obsidian: never a tag (T-R2), it hides the rest of the note instead.
  const inCodeOrLink = codeOrLinkTest(text, tokens, blocks);
  const suspects = tokens.filter((token) => inCodeOrLink(token)).map(({ start, end }) => ({ start, end }));
  const suspectStarts = new Set(suspects.map((suspect) => suspect.start));
  const tags = tokens.filter((token) => !suspectStarts.has(token.start))
    .map((token) => tagOf(token.content, token.start, token.end));
  const comments: CommentSpan[] = [];
  const scanGap = commentScanner(text);
  let gapStart = 0;
  for (const [index, gapEnd] of [...tags.map((tag) => tag.start), text.length].entries()) {
    const found = scanGap(gapStart, gapEnd);
    comments.push(...found);
    if (found.some((comment) => !comment.closed)) break;
    gapStart = tags[index]?.end ?? gapEnd;
  }
  return { tags, comments, suspects };
}

/** Every tag in `text`, in order. */
export function scanTags(text: string, blocks: BlockContext): PartTag[] {
  return scanMarkup(text, blocks).tags;
}

/** Pairs each opener with the end that closes it; ends with nothing open are `stray`. */
export function pairTags(tags: readonly PartTag[]): { parts: OpenPart[]; stray: Array<Extract<PartTag, { kind: 'end' }>> } {
  const parts: OpenPart[] = [];
  const open: OpenPart[] = [];
  const stray: Array<Extract<PartTag, { kind: 'end' }>> = [];
  for (const tag of tags) {
    if (tag.kind !== 'end') {
      const part: OpenPart = { tag, close: null };
      parts.push(part);
      open.push(part);
    } else {
      const part = open.pop();
      if (part) part.close = tag;
      else stray.push(tag);
    }
  }
  return { parts, stray };
}

/** Whether `after` (a merge) still holds the parts of `before` whole: as many closed parts, no more stray or unclosed tags. */
export function partsSurvive(before: string, after: string): boolean {
  const shape = (text: string): { closed: number; broken: number } => {
    const { parts, stray } = pairTags(scanTags(text, 'inline-only'));
    return { closed: parts.filter((part) => part.close !== null).length, broken: stray.length + parts.filter((part) => part.close === null).length };
  };
  const was = shape(before);
  const now = shape(after);
  return now.closed >= was.closed && now.broken <= was.broken;
}
