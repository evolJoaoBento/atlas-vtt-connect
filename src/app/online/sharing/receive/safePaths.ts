/**
 * Where shared items may land. Every title becomes a plain file name: no separators, no
 * characters Windows or Obsidian refuse, no leading or trailing dots, no reserved device names,
 * at most 100 characters. Every path is checked to stay inside its folder after normalising.
 */
import { normalizePath } from 'obsidian';

export const SHARED_ROOT = 'Shared';

const INVALID = /[\\/:*?"<>|#^[\]\p{Cc}]/gu;
/** Bidi overrides, zero-width characters and other invisible format characters. */
const INVISIBLE = /\p{Cf}/gu;
/** Windows reserves these names with any extension (`CON.backup`) and with superscript digits (`COM¹`). */
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])$/i;
const MAX_NAME = 100;

/** `text` cut to at most `max` UTF-16 units without splitting a grapheme. */
function truncated(text: string, max: number): string {
  let out = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}

export function safeFileName(name: string, fallback = 'Untitled'): string {
  let cleaned = name.normalize('NFC').replace(INVISIBLE, '').replace(INVALID, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  if (cleaned.length > MAX_NAME) cleaned = truncated(cleaned, MAX_NAME).replace(/[.\s]+$/g, '');
  if (!cleaned) return fallback;
  const dot = cleaned.indexOf('.');
  const base = dot < 0 ? cleaned : cleaned.slice(0, dot);
  return RESERVED.test(base.trim()) ? `${base}_${cleaned.slice(base.length)}` : cleaned;
}

/** `Shared/<person>`, the folder of everything pulled from that person. */
export function sharedNoteFolder(personName: string): string {
  return `${SHARED_ROOT}/${safeFileName(personName, 'Someone')}`;
}

/** Whether `path` is strictly inside `folder`, with no `.` or `..` segment anywhere. */
export function isInside(path: string, folder: string): boolean {
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return false;
  const normalized = normalizePath(path);
  return normalized.startsWith(`${normalizePath(folder)}/`);
}

/** `folder/stem.extension` (no folder: at the vault root), or `stem (2)`, `stem (3)`, … while `taken` says the path is used. */
export function freePath(folder: string, stem: string, extension: string, taken: (path: string) => boolean): string {
  const prefix = folder ? `${folder}/` : '';
  let path = `${prefix}${stem}.${extension}`;
  for (let n = 2; taken(path); n++) path = `${prefix}${stem} (${n}).${extension}`;
  return path;
}
