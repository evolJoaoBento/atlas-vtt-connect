/**
 * Comments, which are never shared: `%% … %%` and HTML `<!-- … -->`, inline or across lines.
 * Code fences are not tracked on purpose: every comment is removed everywhere, inside code too,
 * and an unclosed one hides the rest of the note. Following fences through quotes and lists
 * kept finding new ways to keep a comment that Obsidian hides, so this fails closed instead.
 * Part tags are found before comments (`privateTags.scanMarkup`), which then pairs comments only between them.
 */
import { lenientQuote } from './quoteLines';

export type CommentOpener = '%%' | '<!--';

/** A comment in a text: `[start, end)` covers its markers; an unclosed one runs to the end of the text. */
export interface CommentSpan {
  start: number;
  end: number;
  opener: CommentOpener;
  /** The text between its markers. */
  content: string;
  closed: boolean;
}

/** A range of a text, `[start, end)`; with `text`, the range is replaced by it instead of removed. */
export interface TextRange {
  start: number;
  end: number;
  text?: string;
}

const OPENERS: readonly CommentOpener[] = ['%%', '<!--'];
const CLOSERS: Record<CommentOpener, string> = { '%%': '%%', '<!--': '-->' };

/**
 * Every comment in `text`, in order; with `from`/`to`, only those that open and close inside `[from, to)`
 * (a gap between part tags). A comment not closed there is unclosed and runs to the end of the text.
 */
export function scanComments(text: string, from = 0, to = text.length): CommentSpan[] {
  return commentScanner(text)(from, to);
}

/** Every start of `needle` in `text` (overlapping ones too, as `indexOf` from each offset would find). */
function positionsOf(text: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) found.push(at);
  return found;
}

/** The first of sorted `positions` at or after `from` whose `needle` ends by `to`, or -1. */
function nextWithin(positions: readonly number[], from: number, to: number, length: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((positions[middle] ?? 0) < from) low = middle + 1;
    else high = middle;
  }
  const at = positions[low];
  return at !== undefined && at + length <= to ? at : -1;
}

/**
 * `scanComments` for many gaps of one text: the markers are found once, so scanning every gap between a
 * note's tags costs one pass, not one pass per tag.
 */
export function commentScanner(text: string): (from: number, to: number) => CommentSpan[] {
  const positions = new Map<string, number[]>([...OPENERS, ...Object.values(CLOSERS)].map((marker) => [marker, positionsOf(text, marker)]));
  const find = (needle: string, from: number, to: number): number => nextWithin(positions.get(needle) ?? [], from, to, needle.length);
  return (from, to) => {
    const spans: CommentSpan[] = [];
    let at = from;
    for (;;) {
      const found = OPENERS.map((opener) => ({ opener, index: find(opener, at, to) }))
        .filter((hit) => hit.index >= 0).sort((a, b) => a.index - b.index)[0];
      if (!found) return spans;
      const contentStart = found.index + found.opener.length;
      const close = find(CLOSERS[found.opener], contentStart, to);
      if (close < 0) {
        spans.push({ start: found.index, end: text.length, opener: found.opener, content: text.slice(contentStart), closed: false });
        return spans;
      }
      const end = close + CLOSERS[found.opener].length;
      spans.push({ start: found.index, end, opener: found.opener, content: text.slice(contentStart, close), closed: true });
      at = end;
    }
  };
}

/**
 * `text` without the plain `hidden` ranges, as the author or a reader sees it, with the offset in `text`
 * of each character it keeps (to map a match back).
 */
export function visibleView(text: string, hidden: readonly TextRange[]): { text: string; offsets: number[] } {
  let view = '';
  const offsets: number[] = [];
  let at = 0;
  const keep = (end: number): void => {
    for (let index = at; index < end; index++) offsets.push(index);
    view += text.slice(at, end);
  };
  for (const range of merged(hidden.filter((candidate) => candidate.text === undefined))) {
    keep(range.start);
    at = Math.max(at, range.end);
  }
  keep(text.length);
  return { text: view, offsets };
}

/**
 * Sorted ranges; plain ones that touch are merged. A replacement that overlaps a plain range is dropped,
 * so a replacement can never uncover what a plain range hides.
 */
function merged(ranges: readonly TextRange[]): TextRange[] {
  const plain = ranges.filter((range) => range.text === undefined);
  const overlaps = (range: TextRange): boolean => plain.some((other) => range.start < other.end && other.start < range.end);
  const sorted = ranges.filter((range) => range.end > range.start && (range.text === undefined || !overlaps(range)))
    .sort((a, b) => a.start - b.start);
  const out: TextRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && last.text === undefined && range.text === undefined && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

/**
 * The lines of `text` without the `hidden` ranges, one entry per line of `text`. A line no range
 * touches stays as it is; a touched line keeps what is left of it, or is null (dropped) when only
 * quote and list markers are left, so no blank line appears where there was none. A replacement's
 * text goes on the line where it starts.
 */
export function keptLines(text: string, hidden: readonly TextRange[]): Array<string | null> {
  const ranges = merged(hidden);
  const out: Array<string | null> = [];
  let lineStart = 0;
  let next = 0;
  for (const line of text.split('\n')) {
    const lineEnd = lineStart + line.length;
    while (next < ranges.length && (ranges[next]?.end ?? 0) <= lineStart) next++;
    let kept = '';
    let at = lineStart;
    let touched = false;
    for (let index = next; index < ranges.length && (ranges[index]?.start ?? Infinity) <= lineEnd; index++) {
      const range = ranges[index];
      if (!range) break;
      touched = true;
      const start = Math.max(range.start, lineStart);
      if (start > at) kept += text.slice(at, start);
      if (range.text !== undefined && range.start >= lineStart) kept += range.text;
      at = Math.max(at, Math.min(range.end, lineEnd));
    }
    if (at < lineEnd) kept += text.slice(at, lineEnd);
    if (!touched) out.push(line);
    else out.push(lenientQuote(kept).content.trim() !== '' ? kept.trimEnd() : null);
    lineStart = lineEnd + 1;
  }
  return out;
}

/** `lines` without their comments, and whether a comment was still open at the end (everything after it was hidden). */
export function stripCommentsChecked(lines: readonly string[]): { lines: string[]; open: boolean } {
  const text = lines.join('\n');
  const comments = scanComments(text);
  const kept = keptLines(text, comments).filter((line): line is string => line !== null);
  return { lines: kept, open: comments[comments.length - 1]?.closed === false };
}
