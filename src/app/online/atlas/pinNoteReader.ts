/**
 * Reads the note a readable pin links, as Atlas's own online play does (`foundNotes.ts`): the pin's `notePath` names a
 * note by path, else as Obsidian resolves the link from the map it is on; only Markdown. The whole note goes without
 * its frontmatter, or for `note#heading` only that heading's section (to the next heading of its level or higher),
 * with the heading as the title. `pinNote` then leaves out the GM's comments and every embed.
 */
import { resolveSubpath, TFile, type App, type CachedMetadata, type HeadingCache } from 'obsidian';
import { pinNote, withoutFrontmatter, type PinNote } from '../tools/pinNotes';

/** The note and heading a pin's `notePath` names (`path/to/note.md#Heading`). */
export function pinNoteLink(notePath: string): { linkpath: string; heading: string | null } {
  const hash = notePath.indexOf('#');
  const linkpath = (hash < 0 ? notePath : notePath.slice(0, hash)).trim();
  const heading = hash < 0 ? '' : notePath.slice(hash + 1).trim();
  return { linkpath, heading: heading === '' ? null : heading };
}

/** The cached heading a pin's `heading` names: exactly as the cache stores it, else as `resolveSubpath` reads a link. */
function headingOf(cache: CachedMetadata, heading: string): HeadingCache | undefined {
  const headings = cache.headings ?? [];
  const exact = headings.find((cached) => cached.heading === heading);
  const line = exact?.position.start.line ?? resolveSubpath(cache, `#${heading}`)?.start.line;
  return headings.find((cached) => cached.position.start.line === line);
}

/** What players read of the pin's note now, from the map at `mapPath`; null where it is gone, is no Markdown or lacks the heading. */
export async function readPinNote(app: App, notePath: string, mapPath: string): Promise<PinNote | null> {
  const { linkpath, heading } = pinNoteLink(notePath);
  if (linkpath === '' || linkpath.toLowerCase().endsWith('.atlasmap')) return null;
  const found = app.vault.getAbstractFileByPath(linkpath) ?? app.metadataCache.getFirstLinkpathDest(linkpath, mapPath);
  if (!(found instanceof TFile) || found.extension !== 'md') return null;
  const content = await app.vault.cachedRead(found);
  if (heading === null) return pinNote(found.basename, withoutFrontmatter(content));
  const cache = app.metadataCache.getFileCache(found);
  const cached = cache ? headingOf(cache, heading) : undefined;
  if (!cache || !cached) return null;
  const headings = cache.headings ?? [];
  const next = headings.slice(headings.indexOf(cached) + 1).find((other) => other.level <= cached.level);
  return pinNote(cached.heading, content.slice(cached.position.end.offset, next?.position.start.offset ?? content.length));
}
