/**
 * Code in a pulled note that other plugins run: Dataview JS and JS Engine blocks, Dataview's inline JS (`$=`),
 * Templater tags and HTML that embeds or runs something. A pull that finds any asks first (`confirmPulledCode`), and
 * "Pull without code" writes the note with that code made inert (`withoutCode`), still readable.
 *
 * Templater reads the raw file, code blocks included, so its tags count anywhere. Everything else counts only where
 * Obsidian renders it: outside fenced code (and, for HTML and `$=`, outside inline code). Fences are told conservatively:
 * only a CommonMark fence (at most three spaces of indent after any `>`) hides what is in it, while a `dataviewjs` or
 * `js-engine` opener counts at any indent (a fence in a list item sits deeper).
 */

export type CodeKind = 'dataviewjs' | 'js-engine' | 'dataview-inline' | 'templater' | 'html';

/** Each kind as the pull dialog names it, in this order. */
export const CODE_KIND_LABELS: Readonly<Record<CodeKind, string>> = {
  dataviewjs: 'Dataview JS blocks',
  'js-engine': 'JS Engine blocks',
  'dataview-inline': 'inline Dataview JS (`$=`)',
  templater: 'Templater commands',
  html: 'embedded HTML (script, iframe, object or embed)',
};
const KIND_ORDER = Object.keys(CODE_KIND_LABELS) as CodeKind[];

/** A fence opener or closer: its prefix (indent, `>` markers), its run of ` or ~, and the rest of the line. */
const FENCE = /^([ \t>]*?)(`{3,}|~{3,})(.*)$/;
/** An opener whose language another plugin runs; group 1 is everything up to the language. */
const RUN_FENCE = /^([ \t>]*(?:`{3,}|~{3,})[ \t]*)(dataviewjs|js-engine)(?=[\s{]|$)/i;
const TEMPLATER = /<%/g;
const HTML_TAG = /<(\/?)(script|iframe|object|embed)(?=[\s/>]|$)/gi;
const HAS_HTML_TAG = new RegExp(HTML_TAG.source, 'i');
/** An inline code span: a run of backticks, its content, the same run again. */
const CODE_SPAN = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
const INLINE_JS = /^(\s*)\$=/;

interface Line {
  text: string;
  /** Inside fenced code (or its opening or closing line): not rendered as Markdown. */
  fenced: boolean;
}

/** A fence's prefix holds no more than three spaces of indent after its `>` markers, and no tab. */
function isCommonMarkFence(prefix: string): boolean {
  let rest = prefix;
  while (/^ {0,3}>/.test(rest)) rest = rest.replace(/^ {0,3}> ?/, '');
  return /^ {0,3}$/.test(rest);
}

/** The note's lines (with their endings), each marked fenced or not. An unclosed fence runs to the end. */
function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let open: { char: string; length: number } | null = null;
  for (const raw of text.split(/(?<=\n)/)) {
    const body = raw.replace(/\r?\n$/, '');
    const fence = FENCE.exec(body);
    if (open) {
      lines.push({ text: raw, fenced: true });
      const run = fence?.[2];
      if (run && run[0] === open.char && run.length >= open.length && fence[3]!.trim() === '') open = null;
      continue;
    }
    if (fence && isCommonMarkFence(fence[1]!) && !(fence[2]![0] === '`' && fence[3]!.includes('`'))) {
      open = { char: fence[2]![0]!, length: fence[2]!.length };
      lines.push({ text: raw, fenced: true });
      continue;
    }
    lines.push({ text: raw, fenced: false });
  }
  return lines;
}

/** `text` with `outside` applied to what lies outside inline code spans, and `span` to each span's content. */
function mapSpans(text: string, outside: (part: string) => string, span: (content: string) => string): string {
  let result = '';
  let last = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    result += outside(text.slice(last, match.index));
    result += `${match[1]!}${span(match[2]!)}${match[1]!}`;
    last = match.index + match[0].length;
  }
  return result + outside(text.slice(last));
}

/** The kinds of executable content in `text`, in `CODE_KIND_LABELS` order; empty for a note with none. */
export function findExecutable(text: string): CodeKind[] {
  const found = new Set<CodeKind>();
  if (/<%/.test(text)) found.add('templater');
  for (const line of linesOf(text)) {
    const language = RUN_FENCE.exec(line.text)?.[2]?.toLowerCase();
    if (language === 'dataviewjs' || language === 'js-engine') found.add(language);
    if (line.fenced) continue;
    mapSpans(line.text, (part) => {
      if (HAS_HTML_TAG.test(part)) found.add('html');
      return part;
    }, (content) => {
      if (INLINE_JS.test(content)) found.add('dataview-inline');
      return content;
    });
  }
  return KIND_ORDER.filter((kind) => found.has(kind));
}

/**
 * `text` with its executable content made inert, everything else byte for byte (line endings included): the fence
 * language becomes `text`, `$=` becomes `$ =`, `<%` becomes `<\%` (Markdown still shows `<%`), and the opening of a
 * script, iframe, object or embed tag becomes `&lt;`, so it shows as text.
 */
export function withoutCode(text: string): string {
  return linesOf(text).map((line) => {
    const defenced = line.text.replace(RUN_FENCE, '$1text').replace(TEMPLATER, '<\\%');
    if (line.fenced) return defenced;
    return mapSpans(defenced, (part) => part.replace(HTML_TAG, '&lt;$1$2'), (content) => content.replace(INLINE_JS, '$1$ ='));
  }).join('');
}

/** What the pull dialog says was found, as one sentence part: "Dataview JS blocks and Templater commands". */
export function codeKindsText(kinds: readonly CodeKind[]): string {
  const labels = kinds.map((kind) => CODE_KIND_LABELS[kind]);
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)!}`;
}
