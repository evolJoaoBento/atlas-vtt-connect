/**
 * Finding a stretch of a note's source in what Obsidian rendered of it, to highlight it there. Rendering drops
 * the Markdown (emphasis, link targets, list and heading markers, comments), so both sides are compared as
 * "plain" characters: Markdown punctuation and whitespace are left out of the rendered text and of the source,
 * and the source's links read as their shown text.
 */

/** Characters compared on neither side: whitespace and the punctuation Markdown may turn into formatting. */
const SKIPPED = /[\s*_~=`\\]/;

/** What `source` (Markdown, comments and tags already removed) shows as, in the compared characters. */
export function plainOf(source: string): string {
  return source
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, '')
    .replace(/^[ \t]*(?:>[ \t]?)*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?)?(?:#{1,6}[ \t]+)?/gm, '')
    .split('')
    .filter((char) => !SKIPPED.test(char))
    .join('');
}

/** A compared character of the rendered text: the text node it is in and its offset there. */
interface Spot {
  node: Text;
  offset: number;
}

/** The compared characters of `root`'s text, skipping `skip` (labels already inserted). */
function spotsOf(root: HTMLElement, skip: string): { text: string; spots: Spot[] } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const spots: Spot[] = [];
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest(`.${skip}`)) continue;
    const textNode = node as Text;
    const value = textNode.data;
    for (let offset = 0; offset < value.length; offset++) {
      const char = value[offset] ?? '';
      if (SKIPPED.test(char)) continue;
      text += char;
      spots.push({ node: textNode, offset });
    }
  }
  return { text, spots };
}

/** Where the `occurrence`-th (0-based) match of `plain` starts in `text`, or -1. */
function nthIndex(text: string, plain: string, occurrence: number): number {
  let at = -1;
  for (let count = 0; count <= occurrence; count++) {
    at = text.indexOf(plain, at + 1);
    if (at < 0) return -1;
  }
  return at;
}

/**
 * Wraps the `occurrence`-th match of `plain` in `root`'s rendered text in elements made by `wrapper`, one per
 * text node it spans; returns them, or null when it is not found.
 */
export function wrapPlain(root: HTMLElement, plain: string, occurrence: number, skip: string, wrapper: () => HTMLElement): HTMLElement[] | null {
  if (plain === '') return null;
  const { text, spots } = spotsOf(root, skip);
  const start = nthIndex(text, plain, occurrence);
  if (start < 0) return null;
  const first = spots[start];
  const last = spots[start + plain.length - 1];
  if (!first || !last) return null;
  const pieces: Array<{ node: Text; from: number; to: number }> = [];
  for (const spot of spots.slice(start, start + plain.length)) {
    const piece = pieces[pieces.length - 1];
    if (piece && piece.node === spot.node) piece.to = spot.offset + 1;
    else pieces.push({ node: spot.node, from: spot.offset, to: spot.offset + 1 });
  }
  // Whitespace between pieces is inside the stretch too: take it into the pieces around it.
  pieces.forEach((piece, index) => {
    if (index < pieces.length - 1) while (piece.to < piece.node.data.length && /\s/.test(piece.node.data[piece.to] ?? '')) piece.to++;
    if (index > 0) while (piece.from > 0 && /\s/.test(piece.node.data[piece.from - 1] ?? '')) piece.from--;
  });
  return pieces.map(({ node, from, to }) => {
    const middle = from > 0 ? node.splitText(from) : node;
    if (to - from < middle.data.length) middle.splitText(to - from);
    const element = wrapper();
    middle.replaceWith(element);
    element.append(middle);
    return element;
  });
}

/** How often `plain` occurs in `text` (compared characters), overlapping matches counted. */
export function occurrencesOf(text: string, plain: string): number {
  if (plain === '') return 0;
  let count = 0;
  for (let at = text.indexOf(plain); at >= 0; at = text.indexOf(plain, at + 1)) count++;
  return count;
}
