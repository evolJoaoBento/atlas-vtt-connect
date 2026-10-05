/** The elements and classes share tags show with, in the editor, reading view and the Share with… preview. */
import type { TagTone } from './tagDisplay';

export const TAG_CLASS = 'atlas-share-tag';
export const HIGHLIGHT_CLASS = 'atlas-share-tag-hl';
export const BLOCK_CLASS = 'atlas-share-tag-block';

/** Classes of a label of `tone`. */
export function labelClass(tone: TagTone): string {
  return `${TAG_CLASS} ${TAG_CLASS}--${tone}`;
}

/** Highlight classes for a part of `tone` nested `depth` deep. */
export function highlightClass(tone: TagTone, depth: number): string {
  return `${HIGHLIGHT_CLASS} ${HIGHLIGHT_CLASS}--${tone}${depth > 0 ? ` ${HIGHLIGHT_CLASS}--nested` : ''}`;
}

/** A label element: "Private", "Only Ana, Ben", … */
export function tagLabelElement(text: string, tone: TagTone): HTMLElement {
  return createSpan({ cls: labelClass(tone).split(' '), text });
}
