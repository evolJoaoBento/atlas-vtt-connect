/**
 * Share tags in reading view (and anything Obsidian renders with section info). Obsidian drops `%%` comments
 * before rendering, so the tags are read from the section's source (`getSectionInfo`) and applied to what was
 * rendered of it:
 * - a section a part covers whole gets the part's highlight on the block;
 * - a part covering only some of a section highlights that text, found by its plain characters
 *   (`renderedText.ts`); when it cannot be found the whole block is highlighted (logged at debug level),
 *   never some other text;
 * - the label goes before the first text the part covers, in whichever section that text is.
 */
import type { BlockContext } from '../model/codeContext';
import { scanMarkup } from '../model/privateTags';
import { occurrencesOf, plainOf, wrapPlain } from './renderedText';
import { tagDisplayOf, type TagDisplay, type TagHighlight, type TagLabel } from './tagDisplay';
import { BLOCK_CLASS, highlightClass, TAG_CLASS, tagLabelElement } from './tagElements';

/** What `MarkdownPostProcessorContext.getSectionInfo` gives: the note's whole source and the section's lines. */
export interface SectionSource {
  text: string;
  lineStart: number;
  lineEnd: number;
}

interface LabelledPart {
  label: TagLabel;
  highlight: TagHighlight;
}

interface NoteModel {
  text: string;
  /** The key of the block context the note was read with (`SectionBlocks.key`). */
  context: unknown;
  display: TagDisplay;
  /** Tags and comments, sorted and apart: never rendered. */
  removed: Array<{ start: number; end: number }>;
  lineStarts: number[];
  /** Each label with the highlight it starts, sorted by where the highlight starts. */
  parts: LabelledPart[];
  /** The largest highlight end among `parts[0..i]`, to find the parts overlapping a section without a full scan. */
  maxEnd: number[];
}

/** The index of the first item in sorted `items` whose `key` is at least `value`. */
function firstAtLeast<T>(items: readonly T[], value: number, key: (item: T) => number): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (key(items[middle] as T) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

let cached: NoteModel | null = null;

/** Sorted ranges with overlapping ones merged (an unclosed comment can hold later tags), so ends are sorted too. */
function disjoint(ranges: ReadonlyArray<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const { start, end } of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else out.push({ start, end });
  }
  return out;
}

/**
 * A note's block context for the reading view: `key` is cheap to compare (the cache's sections array, which
 * Obsidian replaces when it parses the note again), `read` works the context out only when the model is built.
 */
export interface SectionBlocks {
  key: unknown;
  read(): BlockContext;
}

export const INLINE_ONLY: SectionBlocks = { key: 'inline-only', read: () => 'inline-only' };

/** The note's tags, read once per source text and sections (every section of a render shares it). */
function modelOf(text: string, blocks: SectionBlocks): NoteModel {
  // The cache check comes first and costs nothing: working the context out is O(text), once per model.
  if (cached?.text === text && cached.context === blocks.key) return cached;
  const context = blocks.key;
  const scanned = blocks.read();
  const { tags, comments } = scanMarkup(text, scanned);
  const lineStarts = [0];
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) lineStarts.push(at + 1);
  const display = tagDisplayOf(text, scanned);
  const highlightAt = new Map(display.highlights.map((highlight) => [highlight.from, highlight]));
  const parts = display.labels
    .map((label) => ({ label, highlight: highlightAt.get(label.to) }))
    .filter((pair): pair is LabelledPart => pair.highlight !== undefined)
    .sort((a, b) => a.highlight.from - b.highlight.from);
  const maxEnd: number[] = [];
  parts.forEach((part, index) => maxEnd.push(Math.max(part.highlight.to, maxEnd[index - 1] ?? 0)));
  const model: NoteModel = { text, context, display, removed: disjoint([...tags, ...comments]), lineStarts, parts, maxEnd };
  cached = model;
  return model;
}

/** `[from, to)` of the source without tags and comments. */
function shownSource(model: NoteModel, from: number, to: number): string {
  let out = '';
  let at = from;
  for (let index = Math.max(0, firstAtLeast(model.removed, from, (range) => range.end)); index < model.removed.length; index++) {
    const range = model.removed[index];
    if (!range || range.start >= to) break;
    if (range.end <= at) continue;
    out += model.text.slice(at, Math.max(at, range.start));
    at = Math.max(at, range.end);
  }
  return out + model.text.slice(at, Math.max(at, to));
}

/** The first and last offsets in `[from, to)` that render as something (not whitespace, a tag or a comment). */
function shownBounds(model: NoteModel, from: number, to: number): { first: number; last: number } | null {
  const isShown = (offset: number): boolean => {
    if (!/\S/.test(model.text[offset] ?? '')) return false;
    const range = model.removed[firstAtLeast(model.removed, offset + 1, (candidate) => candidate.start) - 1];
    return !(range && offset < range.end);
  };
  let first = from;
  while (first < to && !isShown(first)) first++;
  if (first >= to) return null;
  let last = to - 1;
  while (last > first && !isShown(last)) last--;
  return { first, last };
}

function highlightBlock(el: HTMLElement, highlight: TagHighlight): void {
  [...el.classList].filter((name) => name.startsWith(`${BLOCK_CLASS}--`)).forEach((name) => el.classList.remove(name));
  el.classList.add(BLOCK_CLASS, `${BLOCK_CLASS}--${highlight.tone}`, ...(highlight.depth > 0 ? [`${BLOCK_CLASS}--nested`] : []));
}

const firstTextElement = (el: HTMLElement): HTMLElement =>
  el.querySelector<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li, td, th') ?? el;

const PROCESSED = 'atlasShareTags';

/** Applies the share tags of `source` to `el`, the rendered section; `blocks` gives the note's block context. */
export function decorateSection(el: HTMLElement, source: SectionSource, blocks: SectionBlocks): void {
  if (el.dataset[PROCESSED]) return;
  el.dataset[PROCESSED] = 'true';
  // Every tag is a `%%` comment: most notes have none, and cost nothing more.
  if (!source.text.includes('%%')) return;
  const model = modelOf(source.text, blocks);
  if (model.display.labels.length === 0) return;
  const sStart = model.lineStarts[source.lineStart] ?? model.text.length;
  const sEnd = (model.lineStarts[source.lineEnd + 1] ?? model.text.length + 1) - 1;
  const section = shownBounds(model, sStart, sEnd);
  if (!section) return;
  // Only the parts overlapping this section: those starting before its end whose end lies after its start.
  const pairs: LabelledPart[] = [];
  for (let index = firstAtLeast(model.parts, sEnd, (part) => part.highlight.from) - 1; index >= 0 && (model.maxEnd[index] ?? 0) > sStart; index--) {
    const part = model.parts[index];
    if (part && part.highlight.to > sStart) pairs.unshift(part);
  }
  for (const { label, highlight } of pairs) {
    const part = shownBounds(model, highlight.from, highlight.to);
    const inSection = part ? shownBounds(model, Math.max(highlight.from, sStart), Math.min(highlight.to, sEnd)) : null;
    if (!part || !inSection) continue;
    const ownsLabel = part.first >= sStart && part.first < sEnd;
    const labelEl = (): HTMLElement => tagLabelElement(label.text, label.tone);
    if (highlight.from <= section.first && highlight.to > section.last) {
      highlightBlock(el, highlight);
      if (ownsLabel) firstTextElement(el).prepend(labelEl());
      continue;
    }
    const plain = plainOf(shownSource(model, inSection.first, inSection.last + 1));
    const occurrence = occurrencesOf(plainOf(shownSource(model, sStart, inSection.first)), plain);
    const wrapped = wrapPlain(el, plain, occurrence, TAG_CLASS, () => {
      return createSpan({ cls: highlightClass(highlight.tone, highlight.depth).split(' ') });
    });
    if (wrapped) {
      if (ownsLabel) wrapped[0]?.before(labelEl());
      continue;
    }
    console.debug('[Atlas VTT Connect] Could not find the text of a share tag in reading view; highlighting its block.', label.text);
    highlightBlock(el, highlight);
    if (ownsLabel) firstTextElement(el).prepend(labelEl());
  }
}
