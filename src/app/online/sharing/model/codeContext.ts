/**
 * Whether a tag token may be shown by Obsidian as text rather than read as a comment, so it must not count
 * as a tag. Block context comes from Obsidian's sections (`noteSections.ts`): outside a text block it is text.
 * Inside one:
 * - a list, quote or callout (sections are top-level only, so code nested in them is not a section of its
 *   own): a fence-looking or HTML-looking line earlier in the block, or 4 or more columns of whitespace in the
 *   token line's prefix (indentation, or after a quote or list marker: possibly indented code);
 * - inline, from the start of the token's paragraph (the block, cut at its last blank line): an open code span,
 *   an odd number of backticks on its line, unclosed inline `<code>`/`<pre>`, `$$` or `$` math, an autolink
 *   `<…>` open on its line, a reference definition line, an open link label or wiki link (bracket depth), or a
 *   link destination (`](` not closed by `)`).
 * Backslash escapes are honoured: an escaped character never counts. Detection is deliberately loose: a false
 * "maybe" only hides more (the filter's backstop), while a tag counted where Obsidian shows text could pair
 * with a real one and share a part.
 */
import type { TextRange } from './commentFilter';
import type { TextBlock } from './noteSections';
import { lenientQuote } from './quoteLines';

/** Block context for a scan: Obsidian's text blocks, null when unknown (every token is then text), or `inline-only`. */
export type BlockContext = readonly TextBlock[] | null | 'inline-only';

const REFERENCE_DEFINITION = /^\[[^\]]*\]:/;
const FENCE_HTML_OR_MATH = /^(?:`{3,}|~{3,}|<[A-Za-z!?/]|\$\$)/;
const LIST_ITEM_START = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/;
const QUOTE_MARKERS = /^(?:[ \t]*>)*[ \t]?/;
/** After quote and list markers: an ATX heading, a thematic break, or a setext underline. */
const INTERRUPTS_PARAGRAPH = /^(?:#{1,6}(?:\s|$)|([-*_])(?:[ \t]*\1){2,}[ \t]*$|=+[ \t]*$|-+[ \t]*$)/;

/** `text` with every backslash escape (`\` before ASCII punctuation) masked, so the escaped character never counts. */
function withoutEscapes(text: string): string {
  return text.replace(/\\[!-/:-@[-`{-~]/g, 'xx');
}

/** Whether the character at `at` is escaped: an odd run of backslashes right before it. */
function escapedAt(text: string, at: number): boolean {
  let backslashes = 0;
  for (let index = at - 1; index >= 0 && text[index] === '\\'; index--) backslashes++;
  return backslashes % 2 === 1;
}

const MARKER = /^(?:>|[-*+](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$))/;
const columnsOf = (space: string): number => [...space].reduce((columns, char) => (char === '\t' ? columns + 4 - (columns % 4) : columns + 1), 0);

/** Whether the line's prefix of quote and list markers holds a whitespace run of 4 or more columns (a tab is 4). */
function deepPrefix(line: string): boolean {
  let rest = line;
  for (;;) {
    const space = /^[ \t]*/.exec(rest)?.[0] ?? '';
    if (columnsOf(space) >= 4) return true;
    rest = rest.slice(space.length);
    const marker = MARKER.exec(rest);
    if (!marker) return false;
    rest = rest.slice(marker[0].length);
  }
}

/**
 * Whether the backtick runs of `text` leave a code span open at its end. Outside a span a backslash escapes
 * the next character (so `` \` `` opens nothing); inside one it is literal, and only a run of the opener's
 * length closes it.
 */
function codeSpanOpen(text: string): boolean {
  let open = 0;
  for (let index = 0; index < text.length;) {
    if (open === 0 && text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] !== '`') {
      index++;
      continue;
    }
    let length = 0;
    while (text[index] === '`') { length++; index++; }
    if (open === 0) open = length;
    else if (length === open) open = 0;
  }
  return open !== 0;
}

/** Whether something `opens` marks is left open at the end of `text`: depth counting, a closer at depth 0 changes nothing. */
function depthOpen(text: string, opens: (index: number) => boolean, closer: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (opens(index)) depth++;
    else if (text[index] === closer && depth > 0) depth--;
  }
  return depth > 0;
}

/** Whether a `](` on the line is still open (no `)` closing it yet): the place is inside a link destination. */
function linkDestinationOpen(onLine: string): boolean {
  let depth = 0;
  for (let index = 0; index < onLine.length; index++) {
    if (depth === 0 && onLine[index] === ']' && onLine[index + 1] === '(') {
      depth = 1;
      index++;
    } else if (depth > 0 && onLine[index] === '(') depth++;
    else if (depth > 0 && onLine[index] === ')') depth--;
  }
  return depth > 0;
}

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

/**
 * Inline math, links or HTML before the token, in its paragraph or on its line, that may be open there.
 * Called on the text as written and with escapes masked: open in either reading counts.
 */
function inlineOpen(paragraph: string, onLine: string, line: string): boolean {
  if (count(onLine, /`/g) % 2 === 1) return true;
  if (count(paragraph, /<(?:pre|code)\b/gi) > count(paragraph, /<\/(?:pre|code)\s*>/gi)) return true;
  if (count(paragraph, /\$\$/g) % 2 === 1 || count(paragraph.replace(/\$\$/g, ''), /\$/g) % 2 === 1) return true;
  // An autolink or HTML tag may run over lines (a multi-line attribute): count `<` depth over the paragraph,
  // without the quote markers' `>`.
  const noQuotes = paragraph.replace(/^(?:[ \t]*>)+/gm, (markers) => ' '.repeat(markers.length));
  if (depthOpen(noQuotes, (index) => noQuotes[index] === '<' && /\S/.test(noQuotes[index + 1] ?? ' '), '>')) return true;
  if (REFERENCE_DEFINITION.test(lenientQuote(line).content)) return true;
  return depthOpen(paragraph, (index) => paragraph[index] === '[', ']') || linkDestinationOpen(onLine);
}

/** A test for "possibly shown as text" at the start of each of `ranges` (the tag tokens of `text`). */
export function codeOrLinkTest(text: string, ranges: readonly TextRange[], blocks: BlockContext): (range: TextRange) => boolean {
  // Other tokens' own brackets and backticks must not count: mask them with a plain letter. The masked text
  // keeps every offset, so it is read both as written and with escapes masked.
  const pieces: string[] = [];
  let at = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.start < at) continue;
    pieces.push(text.slice(at, range.start), 'x'.repeat(range.end - range.start));
    at = range.end;
  }
  pieces.push(text.slice(at));
  const tokensMasked = pieces.join('');
  const unescaped = withoutEscapes(tokensMasked);
  const lines = tokensMasked.split('\n');
  const starts: number[] = [];
  lines.reduce((at, line) => { starts.push(at); return at + line.length + 1; }, 0);
  return (range) => {
    // `\%%[!end]%%` is an escaped `%`: Obsidian shows the token as text.
    if (escapedAt(text, range.start)) return true;
    let index = starts.findIndex((start, at) => range.start >= start && range.start <= start + (lines[at]?.length ?? 0));
    if (index < 0) index = lines.length - 1;
    let first = 0;
    if (blocks !== 'inline-only') {
      const block = blocks?.find((candidate) => index >= candidate.startLine && index <= candidate.endLine);
      if (!block) return true;
      if (block.container) {
        if (deepPrefix(lines[index] ?? '')) return true;
        for (let at = block.startLine; at <= index; at++) if (FENCE_HTML_OR_MATH.test(lenientQuote(lines[at] ?? '').content)) return true;
      }
      first = block.startLine;
    }
    // The token's paragraph, read two ways, either reading open counts: back to the last blank line, and back to
    // the start of its list item or quote line run. A span may cross the cut (a lazy line, a quote depth drop,
    // an ordered marker that cannot interrupt a paragraph) or be paired wrongly across it, so neither alone is safe.
    let blankFirst = first;
    for (let at = index - 1; at >= first; at--) {
      if ((lines[at] ?? '').replace(/^(?:[ \t]*>)*/, '').trim() === '') { blankFirst = at + 1; break; }
    }
    let cutFirst = blankFirst;
    const quoteDepth = (line: string): number => (/^(?:[ \t]*>)*/.exec(line)?.[0] ?? '').split('>').length - 1;
    for (let at = index; at >= blankFirst; at--) {
      const line = lines[at] ?? '';
      if (at < index && quoteDepth(line) !== quoteDepth(lines[at + 1] ?? '')) { cutFirst = at + 1; break; }
      if (LIST_ITEM_START.test(line.replace(QUOTE_MARKERS, ''))) { cutFirst = at; break; }
    }
    // A heading, thematic break or setext underline inside a list, quote or callout ends a paragraph too: read
    // from that line and from the next one as well (A-I1).
    const readings = new Set([blankFirst, cutFirst]);
    for (let at = blankFirst; at <= index; at++) {
      if (!INTERRUPTS_PARAGRAPH.test(lenientQuote(lines[at] ?? '').content)) continue;
      readings.add(at);
      if (at + 1 <= index) readings.add(at + 1);
    }
    const lineStart = starts[index] ?? 0;
    const line = lines[index]?.length ?? 0;
    return [...readings].some((paragraphLine) => {
      const from = starts[paragraphLine] ?? 0;
      if (codeSpanOpen(tokensMasked.slice(from, range.start))) return true;
      return [tokensMasked, unescaped].some((reading) => inlineOpen(reading.slice(from, range.start), reading.slice(lineStart, range.start), reading.slice(lineStart, lineStart + line)));
    });
  };
}
