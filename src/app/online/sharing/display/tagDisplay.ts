/**
 * How a note's share tags look, as plain ranges: each start tag shows as a label, the text it covers is
 * highlighted in the label's colour, end tags are not shown. One function for the editor, reading view and
 * the Share with… preview, built on the filter's own scan (`privateTags.scanMarkup` + `pairTags`), so what
 * shows as a tag is what the filter reads as one. Tokens the scan treats as possibly inside code or a link
 * are not tags: they stay as they are written.
 *
 * - A part covers from its tag to its end, or to the end of the text when it is never closed.
 * - A malformed tag hides its part from everyone, so it shows as an "Unreadable tag" label in the private colour.
 * - A stray end tag (nothing open) is hidden and highlights nothing.
 */
import type { BlockContext } from '../model/codeContext';
import { pairTags, scanMarkup, type OpenPart, type PartRule } from '../model/privateTags';

/** The colour of a part: private red, public green, only blue, except orange. */
export type TagTone = 'private' | 'public' | 'only' | 'except';

/** A range `[from, to)` of the text. */
export interface DisplayRange {
  from: number;
  to: number;
}

/** A start tag `[from, to)` shown as a label instead. */
export interface TagLabel extends DisplayRange {
  tone: TagTone;
  text: string;
}

/** Text a part covers; `depth` 0 for a part in no other part. */
export interface TagHighlight extends DisplayRange {
  tone: TagTone;
  depth: number;
}

export interface TagDisplay {
  labels: TagLabel[];
  highlights: TagHighlight[];
  /** End tags, shown as nothing. */
  hidden: DisplayRange[];
}

export const UNREADABLE_TAG_LABEL = 'Unreadable tag';

/** "Private", "Public", "Only Ana, Ben", "Except Cara". */
export function labelOf(rule: PartRule): string {
  if (!('names' in rule)) return rule.kind === 'private' ? 'Private' : 'Public';
  return `${rule.kind === 'only' ? 'Only' : 'Except'} ${rule.names.join(', ')}`;
}

function labelFor(part: OpenPart): Omit<TagLabel, 'from' | 'to'> {
  return part.tag.kind === 'open' ? { tone: part.tag.rule.kind, text: labelOf(part.tag.rule) } : { tone: 'private', text: UNREADABLE_TAG_LABEL };
}

/** The labels, highlights and hidden end tags of `text`, in order of position. */
export function tagDisplayOf(text: string, blocks: BlockContext): TagDisplay {
  // Every tag is a `%%` comment: a note without one has nothing to show (the usual case, and the cheap one).
  if (!text.includes('%%')) return { labels: [], highlights: [], hidden: [] };
  const { tags } = scanMarkup(text, blocks);
  const { parts, stray } = pairTags(tags);
  const labels: TagLabel[] = [];
  const highlights: TagHighlight[] = [];
  const hidden: DisplayRange[] = stray.map((tag) => ({ from: tag.start, to: tag.end }));
  const open: number[] = [];
  for (const part of parts) {
    const end = part.close?.start ?? text.length;
    while (open.length > 0 && (open[open.length - 1] ?? 0) <= part.tag.start) open.pop();
    const look = labelFor(part);
    labels.push({ from: part.tag.start, to: part.tag.end, ...look });
    if (end > part.tag.end) highlights.push({ from: part.tag.end, to: end, tone: look.tone, depth: open.length });
    if (part.close) hidden.push({ from: part.close.start, to: part.close.end });
    open.push(part.close?.end ?? text.length);
  }
  hidden.sort((a, b) => a.from - b.from);
  return { labels, highlights, hidden };
}

/** Whether a selection range touches `range` (touching counts: the cursor right after a tag is on it). */
const touches = (range: DisplayRange, selections: readonly DisplayRange[]): boolean =>
  selections.some((selection) => selection.from <= range.to && selection.to >= range.from);

/** `display` with the tags a selection touches left as written, so they can be edited. */
export function revealedAt(display: TagDisplay, selections: readonly DisplayRange[]): TagDisplay {
  return {
    labels: display.labels.filter((label) => !touches(label, selections)),
    highlights: display.highlights,
    hidden: display.hidden.filter((range) => !touches(range, selections)),
  };
}
