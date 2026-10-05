/** What one recipient may have: the notes whose rule reaches them, the maps shared with them and those maps' ticked notes. */
import type { PeopleBook } from '../people/PeopleBook';
import { ruleReaches, type Recipient } from './audience';
import type { SharedMapSource } from './buildMapPayload';
import { offeredNotes } from './linkedNotes';
import { mapShareReaches, type MapShare } from './mapShare';
import type { ShareRule } from './shareRule';

export interface NoteSource {
  path: string;
  title: string;
  rule: ShareRule;
}

export interface SharedMapEntry {
  name: string;
  mapPath: string;
  share: MapShare;
}

export interface MapAccess {
  entry: SharedMapEntry;
  source: SharedMapSource;
  /** Ticked notes still offered (player-safe: not only behind GM-only pins or hidden tokens), and not explicitly private. */
  linked: string[];
}

export interface Access {
  notes: Map<string, NoteSource>;
  maps: MapAccess[];
}

export interface AccessSources {
  notes(): NoteSource[];
  note(path: string): NoteSource | null;
  maps(): Promise<SharedMapEntry[]>;
  readMap(mapPath: string): Promise<SharedMapSource | null>;
}

export async function accessFor(sources: AccessSources, recipient: Recipient, people: Pick<PeopleBook, 'byName' | 'byKey' | 'isPlaceholder'> & Partial<Pick<PeopleBook, 'unlinkedKey'>>): Promise<Access> {
  const notes = new Map(sources.notes().filter((note) => ruleReaches(note.rule, recipient, people)).map((note) => [note.path, note]));
  const maps: MapAccess[] = [];
  for (const entry of await sources.maps()) {
    if (!mapShareReaches(entry.share, recipient, people)) continue;
    const source = await sources.readMap(entry.mapPath);
    if (!source) continue;
    // A lit map shared player-safe is refused (`SenderCatalogue`): its ticked notes are not offered either.
    const refused = entry.share.mode !== 'full' && source.lit;
    const offered = new Set(refused ? [] : offeredNotes(source.map, entry.share.mode).map((note) => note.path));
    const linked = entry.share.notes.filter((path) => {
      const note = offered.has(path) ? sources.note(path) : null;
      if (!note || note.rule.private) return false;
      notes.set(path, note);
      return true;
    });
    maps.push({ entry, source, linked });
  }
  return { notes, maps };
}
