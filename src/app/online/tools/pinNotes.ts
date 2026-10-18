/**
 * The note of a readable pin, as a player who opens the pin is sent it (`note-request`, `pin-note`): its title and its
 * Markdown, as Atlas's own online play reads it (`foundNotes.ts`): the whole note without its frontmatter, or only the
 * section of the heading the pin links, and never the GM's comments. Embeds are left out, so no other note or image
 * goes with it, and links keep only their text. Shared with the web page, so this file imports nothing.
 */

export const PIN_NOTE_LIMITS = {
  title: 120,
  /** The body's UTF-8 bytes, well inside a control message. */
  bodyBytes: 96 * 1024,
  /** Pins a player may open each second. */
  requestsPerSecond: 2,
} as const;

export interface PinNote {
  title: string;
  /** Markdown, as `pinNote` leaves it. */
  body: string;
  /** The body was cut to fit `PIN_NOTE_LIMITS.bodyBytes`. */
  cut?: true;
}

/** The GM's answer to a pin a player opened, for the scene and pin it was asked for. */
export interface PinNoteAnswer {
  sceneId: string;
  pinId: string;
  note: PinNote | null;
}

/** Obsidian's comments (`%% … %%`) and HTML comments: the GM's own words, never shown in reading view. */
const COMMENTS = /%%[\s\S]*?(?:%%|$)|<!--[\s\S]*?(?:-->|$)/g;
/** Embeds of other notes, images or files: `![[…]]` and `![alt](url)`. */
const EMBEDS = /!\[\[[^\]\n]*\]\]|!\[[^\]\n]*\]\([^)\n]*\)/g;

/** Markdown without the comments the GM wrote for themselves, trimmed. */
export function withoutComments(text: string): string {
  return text.replace(COMMENTS, '').trim();
}

/** A note's text past its frontmatter (`---` lines at its very top). */
export function withoutFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  return match ? content.slice(match[0].length) : content;
}

/** Cuts `text` to at most `bytes` of UTF-8, on a character boundary. */
function cutToBytes(text: string, bytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= bytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, middle)).length <= bytes) low = middle;
    else high = middle - 1;
  }
  // Never half a surrogate pair.
  const end = low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1]!) ? low - 1 : low;
  return text.slice(0, end);
}

/** The note as a player is sent it: one-line title, no comments or embeds, cut to the limit. */
export function pinNote(title: string, markdown: string): PinNote {
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  const shownTitle = cleanTitle.length <= PIN_NOTE_LIMITS.title ? cleanTitle : `${cleanTitle.slice(0, PIN_NOTE_LIMITS.title - 1)}…`;
  const body = withoutComments(markdown).replace(EMBEDS, '').replace(/\n{3,}/g, '\n\n').trim();
  const cut = cutToBytes(body, PIN_NOTE_LIMITS.bodyBytes);
  return { title: shownTitle || 'Note', body: cut, ...(cut.length < body.length ? { cut: true as const } : {}) };
}

export function isPinNote(value: unknown): value is PinNote {
  if (typeof value !== 'object' || value === null) return false;
  const note = value as Record<string, unknown>;
  return typeof note.title === 'string' && note.title.length <= PIN_NOTE_LIMITS.title
    && typeof note.body === 'string' && note.body.length <= PIN_NOTE_LIMITS.bodyBytes
    && (note.cut === undefined || note.cut === true);
}
