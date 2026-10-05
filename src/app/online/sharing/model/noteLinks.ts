/**
 * Links in a shared note. A link to a note the receiver also gets points at that note's shared
 * title; every other link (and every embed of a file that is not a note) becomes its text, so
 * no name of an unshared note or file leaves the sender. Only web links stay (`https`, `mailto`
 * and the like): `obsidian://`, `app://` and `file://` carry vault names and paths. Reference-style
 * links (`[text][ref]` with a `[ref]: target` line) are resolved like inline ones, a link around an
 * image is rewritten from the inside out, and the HTML attributes `href`, `src` and the like are
 * dropped unless they point at the web.
 */

/** The title the receiver knows a link target by; null when they do not get it. */
export type LinkResolver = (linkpath: string) => string | null;

const LABEL = String.raw`((?:\\.|[^\[\]\\]|\[[^\[\]]*\])*)`;
const MARKDOWN_LINK = new RegExp(String.raw`(!?)\[${LABEL}\]\(([^)]*)\)`, 'g');
const REFERENCE_LINK = new RegExp(String.raw`(!?)\[${LABEL}\]\[([^\]]*)\]`, 'g');
const SHORTCUT_LINK = new RegExp(String.raw`(!?)\[${LABEL}\](?![(\[:])`, 'g');
const DEFINITION_HEAD = String.raw`^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)]))*[ \t]*\[(?!\^)((?:\\.|[^\]\\])+)\]:`;
const DEFINITION = new RegExp(String.raw`${DEFINITION_HEAD}[ \t]*(<[^>]*>|\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$`);
/** A definition whose target is on the next line. */
const DEFINITION_ALONE = new RegExp(String.raw`${DEFINITION_HEAD}[ \t]*$`);
const TARGET_LINE = /^[ \t]*(<[^>]*>|\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const TITLE_LINE = /^[ \t]*(?:"[^"]*"|'[^']*'|\([^)]*\))[ \t]*$/;
/** Targets that stay as written. */
const WEB = /^(?:https?|mailto|tel|ftp|data):|^\/\//i;
const HTML_TAG = /<[a-zA-Z](?:"[^"]*"|'[^']*'|[^>"'])*>/g;
const URL_ATTRIBUTE = /\s(?:href|src|srcset|poster|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi;

const nameOf = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '');
const isSize = (text: string): boolean => /^\d+(?:x\d+)?$/.test(text.trim());

function splitTarget(raw: string): { path: string; sub: string } {
  const at = raw.search(/[#^]/);
  return at < 0 ? { path: raw, sub: '' } : { path: raw.slice(0, at), sub: raw.slice(at) };
}

const cleanTarget = (raw: string): string => raw.trim().replace(/^<|>$/g, '').replace(/\s+"[^"]*"$/, '');

function decoded(target: string): string {
  try {
    return decodeURI(target);
  } catch {
    return target;
  }
}

/** The result of a link to `target` with `label`, or null when it points at the web and stays as written. */
function rewriteTarget(bang: string, label: string, rawTarget: string, resolve: LinkResolver): string | null {
  const target = cleanTarget(rawTarget);
  if (WEB.test(target)) return null;
  const { path, sub } = splitTarget(decoded(target));
  const title = path ? resolve(path) : null;
  if (!title) return label;
  return bang ? `![[${title}${sub}]]` : `[[${title}${sub}|${label}]]`;
}

/** What a wiki link that is not kept shows: its alias, or the file name (an embed's size alias is not text). */
function wikiText(bang: string, raw: string, alias: string | undefined): string {
  const { path, sub } = splitTarget(raw.trim());
  if (alias !== undefined && !(bang && isSize(alias))) return alias;
  return path ? nameOf(path) : sub.replace(/^[#^]/, '');
}

/** Where the `]]` that closes the `[[` at `from` is, counting nested `[[`; -1 when it never closes. */
function wikiEnd(text: string, from: number): number {
  let depth = 0;
  for (let at = from; at < text.length - 1; at++) {
    const pair = text.slice(at, at + 2);
    if (pair === '[[') {
      depth++;
      at++;
    } else if (pair === ']]') {
      if (--depth === 0) return at;
      at++;
    }
  }
  return -1;
}

/**
 * Calls `decide` for every wiki link, from the outside in. A link nested inside another link's alias (or target)
 * is flattened to its text first, so `decide` never sees brackets inside what it is given and no inner path survives.
 */
function mapWiki(text: string, decide: (bang: string, raw: string, alias: string | undefined) => string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('[[', at);
    if (open < 0) return out + text.slice(at);
    const close = wikiEnd(text, open);
    if (close < 0) {
      out += text.slice(at, open + 2); // an unclosed opener is plain text; links after it still count
      at = open + 2;
      continue;
    }
    const bang = open > at && text[open - 1] === '!' ? '!' : '';
    out += text.slice(at, open - bang.length);
    const content = text.slice(open + 2, close);
    const bar = content.indexOf('|');
    const target = bar < 0 ? content : content.slice(0, bar);
    if (target.includes('[[')) {
      out += mapWiki(content, wikiText);
    } else {
      const alias = bar < 0 ? undefined : mapWiki(content.slice(bar + 1), wikiText);
      out += decide(bang, target, alias);
    }
    at = close + 2;
  }
}

function rewriteWiki(text: string, resolve: LinkResolver): string {
  return mapWiki(text, (bang, raw, alias) => {
    const { path, sub } = splitTarget(raw.trim());
    const title = path ? resolve(path) : null;
    if (title) return `${bang}[[${title}${sub}${alias !== undefined ? `|${alias}` : ''}]]`;
    return wikiText(bang, raw, alias);
  });
}

/** Link reference definitions: the ones that point at files are taken out; their labels map to their targets. */
function takeDefinitions(lines: readonly string[]): { kept: string[]; targets: Map<string, string> } {
  const targets = new Map<string, string>();
  const kept: string[] = [];
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? '';
    const alone = DEFINITION_ALONE.exec(line);
    const next = alone ? TARGET_LINE.exec(lines[at + 1] ?? '') : null;
    const match = DEFINITION.exec(line);
    const label = match?.[1] ?? alone?.[1];
    const target = cleanTarget(match?.[2] ?? next?.[1] ?? '');
    if (label === undefined || target === '' || WEB.test(target)) {
      kept.push(line);
      continue;
    }
    targets.set(label.trim().toLowerCase(), target);
    if (next) at += TITLE_LINE.test(lines[at + 2] ?? '') ? 2 : 1;
  }
  return { kept, targets };
}

/** Reference and inline links, each rewritten from the inside out so a link around an image leaks neither path. */
function rewriteSpans(text: string, targets: ReadonlyMap<string, string>, resolve: LinkResolver): string {
  const inside = (label: string): string => rewriteSpans(label, targets, resolve);
  const through = (all: string, bang: string, label: string, ref: string): string => {
    const target = targets.get(ref.trim().toLowerCase());
    return target === undefined ? all : rewriteTarget(bang, inside(label), target, resolve) ?? all;
  };
  return text
    .replace(REFERENCE_LINK, (all: string, bang: string, label: string, ref: string) => through(all, bang, label, ref === '' ? label : ref))
    .replace(SHORTCUT_LINK, (all: string, bang: string, label: string) => through(all, bang, label, label))
    .replace(MARKDOWN_LINK, (all: string, bang: string, label: string, raw: string) => {
      const inner = inside(label);
      return rewriteTarget(bang, inner, raw, resolve) ?? (inner === label ? all : `${bang}[${inner}](${raw})`);
    });
}

function stripHtmlUrls(text: string): string {
  return text.replace(HTML_TAG, (tag) => tag.replace(URL_ATTRIBUTE, (all: string, double?: string, single?: string, bare?: string) => {
    const value = (double ?? single ?? bare ?? '').trim();
    const urls = value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0] ?? '');
    return urls.every((url) => WEB.test(url) || url.startsWith('#')) ? all : '';
  }));
}

const MAX_PASSES = 8;
/** Runs `pass` until it changes nothing, at most `MAX_PASSES` times. */
function untilStable(text: string, pass: (text: string) => string): string {
  let current = text;
  for (let count = 0; count < MAX_PASSES; count++) {
    const next = pass(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/** The last net: any inline link or image still aimed at something that is not the web becomes its text, however deeply nested. */
const sweep = (text: string): string =>
  untilStable(text, (current) => current.replace(MARKDOWN_LINK, (all: string, _bang: string, label: string, raw: string) => (WEB.test(cleanTarget(raw)) ? all : label)));

/** Where the `)` closing the destination that starts at `from` is (balanced parentheses, `<…>` skipped); -1 when the line ends first. */
function destinationEnd(text: string, from: number): number {
  let depth = 1;
  for (let at = from; at < text.length && text[at] !== '\n'; at++) {
    const char = text[at];
    if (char === '<' && at === from) {
      const close = text.indexOf('>', at);
      if (close < 0 || text.slice(at, close).includes('\n')) return -1;
      at = close;
    } else if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return at;
  }
  return -1;
}

/**
 * The net that does not depend on how the label nests: every `](destination)` that is not the web loses its
 * destination, however many brackets the label holds. A destination that never closes on its line is dropped to the line's end.
 */
function stripDestinations(text: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('](', at);
    if (open < 0) return out + text.slice(at);
    const end = destinationEnd(text, open + 2);
    const lineEnd = text.indexOf('\n', open);
    const stop = end >= 0 ? end + 1 : lineEnd < 0 ? text.length : lineEnd;
    if (end >= 0 && WEB.test(cleanTarget(text.slice(open + 2, end)))) {
      out += text.slice(at, stop);
    } else {
      out += text.slice(at, open + 1);
    }
    at = stop;
  }
}

const ANY_DEFINITION = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)]))*[ \t]*\[(?!\^).*\]:[ \t]*(.*)$/;

/** Reference definitions whatever their label's brackets: a line `[…]: target` (or `[…]:` with the target on the next line) that is not the web is dropped. */
function stripDefinitions(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  for (let at = 0; at < lines.length; at++) {
    const rest = ANY_DEFINITION.exec(lines[at] ?? '')?.[1];
    const target = rest === undefined ? undefined : rest.trim() === '' ? TARGET_LINE.exec(lines[at + 1] ?? '')?.[1] : rest.trim().split(/\s+/)[0];
    if (rest === undefined || target === undefined || WEB.test(cleanTarget(target))) {
      kept.push(lines[at] ?? '');
      continue;
    }
    if (rest.trim() === '') at += TITLE_LINE.test(lines[at + 2] ?? '') ? 2 : 1;
  }
  return kept.join('\n');
}

/** The last net for wiki links: one whose target is not a title this pass wrote becomes its text (an embed, only its file name). */
function wikiSweep(text: string, titles: ReadonlySet<string>): string {
  return mapWiki(text, (bang, raw, alias) => {
    const { path } = splitTarget(raw.trim());
    if (path && titles.has(path)) return `${bang}[[${raw}${alias !== undefined ? `|${alias}` : ''}]]`;
    return alias !== undefined && !bang ? alias : wikiText(bang, raw, undefined);
  });
}

export function rewriteLinks(text: string, resolve: LinkResolver): string {
  const titles = new Set<string>();
  const tracked: LinkResolver = (linkpath) => {
    const title = resolve(linkpath);
    if (title) titles.add(title);
    return title;
  };
  const { kept, targets } = takeDefinitions(rewriteWiki(text, tracked).split('\n'));
  const rewritten = untilStable(kept.join('\n'), (current) => rewriteSpans(current, targets, tracked));
  const swept = untilStable(rewritten, (current) => sweep(wikiSweep(current, titles)));
  return stripHtmlUrls(stripDefinitions(stripDestinations(swept)));
}
