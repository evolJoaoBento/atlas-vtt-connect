/**
 * Known kinds of content in a pulled note that other plugins run, or that loads from the internet: code blocks for
 * plugins such as Dataview, Datacore or JS Engine, Dataview's inline JS (`$=`), Templater tags, HTML that runs or
 * embeds something, and HTML that fetches a URL. A pull that finds any asks first (`confirmPulledCode`), and "Pull
 * without code" writes the note with all of it made inert (`withoutCode`), still readable.
 *
 * Detection errs towards flagging: it reads the whole note, code blocks and inline code included, so no way of
 * hiding a part from the parser (a fence that Markdown does not open, an HTML block, a quote that ends) hides it from
 * the check. The parse into code and prose (`regionsOf`, as Obsidian reads fences, quote by quote, and inline code
 * across line breaks) only chooses how each part is made inert: visibly escaped in prose, with an invisible break
 * in code, where an escape would show. These are the kinds Connect knows; other plugins can run other code.
 */

export type CodeKind = 'code-block' | 'dataview-inline' | 'templater' | 'html' | 'remote';

/** Each kind as the pull dialog names it, in this order. */
export const CODE_KIND_LABELS: Readonly<Record<CodeKind, string>> = {
  'code-block': 'code blocks other plugins run (such as Dataview, Datacore or JS Engine)',
  'dataview-inline': 'inline Dataview JS (`$=`, anywhere in the note)',
  templater: 'Templater commands',
  html: 'embedded HTML (script, iframe, object or embed)',
  remote: 'HTML that loads from the internet (style, img, link, audio, video or source), which can reveal your IP address',
};
const KIND_ORDER = Object.keys(CODE_KIND_LABELS) as CodeKind[];

/** A fence language a plugin runs, or may: over-flagging plain `js` is accepted. */
const RUN_LANGUAGE = /js|ts|jsx|tsx|dataview|datacore|engine|templater/i;
/** A fence opener anywhere: after quote markers, list markers and any indent; group 2 is its language. */
const OPENER = /^((?:[ \t>]|[-*+][ \t]|\d{1,9}[.)][ \t])*(?:`{3,}|~{3,})[ \t]*)([^\s`{]+)/;
const TEMPLATER = /<%/g;
const HTML_TAG = /<(\/?)(script|iframe|object|embed|webview|frameset|frame)(?=[\s/>]|$)/gi;
/** `<style>` can `@import` or `url()` anything; the other tags only when they name a URL off this device. */
const REMOTE_TAG = /<(style)(?=[\s/>]|$)|<(img|link|audio|video|source)(?=[\s/>])[^>]*?(?:https?:)?\/\//gi;
/**
 * Dataview's inline JS prefix, `$=`, anywhere: Dataview reads it at the start of any rendered code element (an inline
 * span, a whole code block in any language, a raw-HTML `<code>`, where entities are decoded first), so its place in
 * the Markdown says nothing. Entity forms of `$` and `=` count too.
 */
const INLINE_JS = /(?:\$|&#0*36;|&#x0*24;|&dollar;)(?:=|&#0*61;|&#x0*3d;|&equals;)/gi;

/** `$=` gets an invisible break; an entity form gets its `&` written as `&amp;`, so it no longer decodes. */
const inertInline = (match: string): string => (match.includes('&') ? match.replace(/&/g, '&amp;') : `$${BREAK}=`);
/** An invisible break: `<` or `$` followed by it is neither a tag, a Templater tag nor Dataview's prefix. */
const BREAK = '​';

function test(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  const found = pattern.test(text);
  pattern.lastIndex = 0;
  return found;
}

/** Whether a line opens a fence whose language a plugin runs (`RUN_LANGUAGE`). */
function runsCode(line: string): boolean {
  const language = OPENER.exec(line)?.[2];
  return language !== undefined && RUN_LANGUAGE.test(language);
}

/** The kinds of known code in `text`, in `CODE_KIND_LABELS` order; empty for a note with none. */
export function findExecutable(text: string): CodeKind[] {
  const found = new Set<CodeKind>();
  if (text.split('\n').some(runsCode)) found.add('code-block');
  if (test(INLINE_JS, text)) found.add('dataview-inline');
  if (test(TEMPLATER, text)) found.add('templater');
  if (test(HTML_TAG, text)) found.add('html');
  if (test(REMOTE_TAG, text)) found.add('remote');
  return KIND_ORDER.filter((kind) => found.has(kind));
}

interface Region {
  text: string;
  /** Shown as code (a fenced block or an inline span): an escape there would show. */
  code: boolean;
}

/** The quote depth of a line (`>` markers, each after at most three spaces) and what follows them. */
function quoted(line: string): { depth: number; rest: string } {
  let rest = line;
  let depth = 0;
  for (let marker = /^ {0,3}> ?/.exec(rest); marker; marker = /^ {0,3}> ?/.exec(rest)) {
    depth++;
    rest = rest.slice(marker[0].length);
  }
  return { depth, rest };
}

/** Removes `depth` quote markers from the start of a line inside a fence (its own `>` are code). */
function unquoted(line: string, depth: number): string {
  let rest = line;
  for (let index = 0; index < depth; index++) rest = rest.replace(/^ {0,3}> ?/, '');
  return rest;
}

/** Lines as Obsidian reads fences: one opened in a quote ends where the quote ends; an unclosed one runs on. */
function fencedLines(text: string): Array<{ text: string; fenced: boolean }> {
  const lines: Array<{ text: string; fenced: boolean }> = [];
  let open: { char: string; length: number; depth: number } | null = null;
  for (const raw of text.split(/(?<=\n)/)) {
    const body = raw.replace(/\r?\n$/, '');
    if (open) {
      const { depth } = quoted(body);
      if (depth >= open.depth) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(unquoted(body, open.depth));
        if (close && close[1]![0] === open.char && close[1]!.length >= open.length) open = null;
        lines.push({ text: raw, fenced: true });
        continue;
      }
      open = null;
    }
    const { depth, rest } = quoted(body);
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(rest);
    if (fence && !(fence[1]![0] === '`' && fence[2]!.includes('`'))) {
      open = { char: fence[1]![0]!, length: fence[1]!.length, depth };
      lines.push({ text: raw, fenced: true });
      continue;
    }
    lines.push({ text: raw, fenced: false });
  }
  return lines;
}

/** An inline code span, across line breaks but not a blank line; an escaped backtick opens none. */
const CODE_SPAN = /(?<![\\`])(`+)(?!`)((?:(?!\n[ \t>]*\r?\n)[\s\S])*?[^`])\1(?!`)/g;

/** The note as code and prose, in order: fenced blocks and inline spans are code. */
function regionsOf(text: string): Region[] {
  const regions: Region[] = [];
  let prose = '';
  const flush = (): void => {
    let last = 0;
    for (const match of prose.matchAll(CODE_SPAN)) {
      const start = match.index + match[1]!.length;
      regions.push({ text: prose.slice(last, start), code: false }, { text: match[2]!, code: true });
      last = start + match[2]!.length;
    }
    regions.push({ text: prose.slice(last), code: false });
    prose = '';
  };
  for (const line of fencedLines(text)) {
    if (!line.fenced) {
      prose += line.text;
      continue;
    }
    flush();
    regions.push({ text: line.text, code: true });
  }
  flush();
  return regions.filter((region) => region.text !== '');
}

/** One region made inert: escaped as it reads in prose, broken invisibly in code. */
function inert(region: Region): string {
  const lt = region.code ? `<${BREAK}` : '&lt;';
  return region.text
    .split(/(?<=\n)/).map((line) => (runsCode(line) ? line.replace(OPENER, '$1text') : line)).join('')
    .replace(TEMPLATER, region.code ? `<${BREAK}%` : '<\\%')
    .replace(HTML_TAG, (_tag, slash: string, name: string) => `${lt}${slash}${name}`)
    .replace(REMOTE_TAG, (tag: string) => `${lt}${tag.slice(1)}`)
    .replace(INLINE_JS, inertInline);
}

/**
 * `text` with every known kind made inert and everything else byte for byte, line endings included: a fence
 * language a plugin runs becomes `text`, Templater's `<%` becomes `<\%` (in code `<`, a zero-width space, `%`), a
 * listed tag's `<` becomes `&lt;` (in code `<` and a zero-width space), and `$=` after a backtick becomes `$`,
 * a zero-width space, `=`.
 */
export function withoutCode(text: string): string {
  // What straddles a region's edge (a tag whose URL sits in a span, `$=` after a span's backtick) is left after the
  // regions: one more pass over the whole text, as prose, catches it.
  return inert({ text: regionsOf(text).map(inert).join(''), code: false });
}

/** What the pull dialog says was found, as one sentence part: "Templater commands and embedded HTML (…)". */
export function codeKindsText(kinds: readonly CodeKind[]): string {
  const labels = kinds.map((kind) => CODE_KIND_LABELS[kind]);
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join('; ')}; and ${labels.at(-1)!}`;
}
