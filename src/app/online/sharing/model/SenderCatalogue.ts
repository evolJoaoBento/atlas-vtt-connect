/**
 * The sender's side of sharing: what a recipient may list and open, built fresh from the vault
 * each time, filtered for them before it is hashed. A version is the SHA-256 of exactly what
 * would be sent, so an edit to a part they never get never shows them an update. Calls name `self`, this
 * Atlas's person id at the recipient's table, so parts meant for some people arrive marked for the sender too.
 */
import type { CollectionGridDefaults, InitiativeRules } from '@atlas-vtt/api-types';
import { mimeForPath, sha256Id, type AssetMime, type Hasher } from '../../assets/assetIds';
import type { ImageFiles } from '../../scene/AssetRegistry';
import type { PlayerViewRules } from '../../scene/playerViewRules';
import type { MapSize } from '../../scene/sceneTypes';
import type { PeopleBook } from '../people/PeopleBook';
import { keyOf, personKey } from '../people/peopleTypes';
import { isPerson, partAllows, type Recipient } from './audience';
import { fullPayload, hashMapImages, playerSafePayload, playerSafeRefusal, type MapImages } from './buildMapPayload';
import { accessFor, type Access, type AccessSources, type MapAccess } from './catalogueAccess';
import type { MapShareMode } from './mapShare';
import { previewAsPlaceholder, type PreviewPeople } from './placeholderPreview';
import { forwardedOpenTag, localizeForwardedTags, MAX_FORWARD_NAMES } from './forwardedParts';
import { filterNoteFor, strayEndLineIn, strayEndProblem } from './noteFilter';
import type { NoteSection } from './noteSections';
import type { PartMarks } from './privateParts';
import type { ShareItems } from './ShareItems';

export const MAX_CATALOGUE_ITEMS = 500;

export interface CatalogueItem {
  item: string;
  kind: 'note' | 'map';
  title: string;
  version: string;
  size: number;
  mode?: MapShareMode;
  /** A map's ticked notes, as item ids. */
  linked?: string[];
}

export interface SharePayload {
  kind: 'note' | 'map' | 'image';
  bytes: ArrayBuffer;
  version: string;
  mime?: AssetMime;
}

export interface CatalogueSources extends AccessSources {
  /**
   * A note's text and Obsidian's sections for it (`metadataCache` sections; null when there are none). The
   * filter checks that the sections fit this exact text and keeps tags back when they do not.
   */
  readNote(path: string): Promise<{ text: string; sections: readonly NoteSection[] | null }>;
  images: ImageFiles;
  isFile(path: string): boolean;
  /** The vault path a link in `from` points at; null when it resolves to nothing. */
  resolveLink(linkpath: string, from: string): string | null;
  shareable(): readonly string[];
  rules(): PlayerViewRules;
  collectionGrid(mapPath: string): CollectionGridDefaults | null;
  /** The cone angle of the measure tool on the map at `mapPath` (`rules.forMap`). */
  coneAngle(mapPath: string): number;
  /** The initiative rules of the collection holding the map at `mapPath`. */
  initiativeRules(mapPath: string): InitiativeRules;
}

function utf8(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text);
  const bytes = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(bytes).set(encoded);
  return bytes;
}

export class SenderCatalogue {
  constructor(
    private readonly sources: CatalogueSources,
    private readonly items: Pick<ShareItems, 'idFor' | 'pathOf' | 'ready'>,
    private readonly people: Pick<PeopleBook, 'byName' | 'allByName' | 'byKey' | 'ready' | 'list' | 'get' | 'isPlaceholder' | 'placeholderByName'>,
    private readonly hash: Hasher = sha256Id,
    private readonly dimensions?: (bytes: ArrayBuffer) => Promise<MapSize | null>,
  ) {}

  /** The access of one recipient, once the stored ids and people are read. */
  private async access(recipient: Recipient, people: PreviewPeople = this.people): Promise<Access> {
    await Promise.all([this.items.ready(), this.people.ready()]);
    return accessFor(this.sources, recipient, people);
  }

  async list(recipient: Recipient, self?: string): Promise<CatalogueItem[]> {
    const access = await this.access(recipient);
    const items: CatalogueItem[] = [];
    for (const note of access.notes.values()) {
      if (items.length >= MAX_CATALOGUE_ITEMS) break;
      const payload = await this.notePayload(note.path, recipient, access, self);
      // A note with a stray end tag is not shared until the sender fixes it.
      if (!payload) continue;
      items.push({ item: this.items.idFor(note.path), kind: 'note', title: note.title, version: payload.version, size: payload.bytes.byteLength });
    }
    for (const map of access.maps) {
      if (items.length >= MAX_CATALOGUE_ITEMS) break;
      const built = await this.mapPayload(map);
      // A share the sender refuses (a player-safe share `playerSafeRefusal` refuses) is not offered.
      if (!built) continue;
      const { version, bytes } = built;
      items.push({
        item: map.entry.share.item, kind: 'map', title: map.entry.name, version, size: bytes.byteLength,
        mode: map.entry.share.mode, linked: map.linked.map((path) => this.items.idFor(path)),
      });
    }
    return items;
  }

  /** A note, a map, or a map's image (`<map item>/<fingerprint>`), when this recipient may have it; null otherwise. */
  async open(recipient: Recipient, ref: string, self?: string): Promise<SharePayload | null> {
    const access = await this.access(recipient);
    const slash = ref.indexOf('/');
    if (slash >= 0) return this.image(access, ref.slice(0, slash), ref.slice(slash + 1));
    const map = access.maps.find((candidate) => candidate.entry.share.item === ref);
    if (map) return (await this.mapPayload(map))?.payload ?? null;
    const path = this.items.pathOf(ref);
    return path && access.notes.has(path) ? this.notePayload(path, recipient, access, self) : null;
  }

  /** The note as this person would get it, whatever its rule says now (the dialog's preview), its tags naming people as this list does. */
  async previewNote(recipient: Recipient, path: string, self?: string): Promise<string> {
    const text = await this.noteText(path, recipient, await this.access(recipient), self);
    if (text === null) {
      const note = await this.sources.readNote(path);
      return strayEndProblem(strayEndLineIn(note.text, note.sections) ?? 0);
    }
    return localizeForwardedTags(text, recipient.tableId, (personId) => (personId === self ? 'you' : this.people.get(recipient.tableId, personId)?.name ?? null));
  }

  /** The note as someone not met yet would get it once linked (the dialog's "Preview as"); null when `name` is no placeholder. */
  async previewNoteAsPlaceholder(name: string, path: string): Promise<string | null> {
    await this.people.ready();
    const stand = previewAsPlaceholder(this.people, name);
    if (!stand) return null;
    const text = await this.noteText(path, stand.recipient, await this.access(stand.recipient, stand.people), undefined, stand.people);
    if (text === null) {
      const note = await this.sources.readNote(path);
      return strayEndProblem(strayEndLineIn(note.text, note.sections) ?? 0);
    }
    return text;
  }

  /** Restricted parts the recipient gets name the sender and everyone else at their table the part lets in. */
  private marksFor(recipient: Recipient, self: string | undefined, people: PreviewPeople = this.people): PartMarks {
    return {
      openTag: (rule) => {
        const others = people.list()
          .filter((person) => person.tableId === recipient.tableId && person.personId !== self && !isPerson(person, recipient))
          .filter((person) => partAllows(rule, { tableId: person.tableId, personId: person.personId }, people))
          .map(keyOf);
        return forwardedOpenTag([...(self ? [personKey(recipient.tableId, self)] : []), ...others].slice(0, MAX_FORWARD_NAMES));
      },
    };
  }

  /** Null for a note that is not shared at all: a stray end tag (`strayEndLineIn`). */
  private async noteText(path: string, recipient: Recipient, access: Access, self: string | undefined, people: PreviewPeople = this.people): Promise<string | null> {
    const { text: source, sections } = await this.sources.readNote(path);
    if (strayEndLineIn(source, sections) !== null) return null;
    return filterNoteFor(source, {
      recipient, people, shareable: this.sources.shareable(), marks: this.marksFor(recipient, self, people), sections,
      links: (linkpath) => {
        const target = this.sources.resolveLink(linkpath, path);
        return target ? access.notes.get(target)?.title ?? null : null;
      },
    });
  }

  private async notePayload(path: string, recipient: Recipient, access: Access, self: string | undefined): Promise<SharePayload | null> {
    const text = await this.noteText(path, recipient, access, self);
    if (text === null) return null;
    const bytes = utf8(text);
    return { kind: 'note', bytes, version: await this.hash(bytes) };
  }

  /** Null when the share is refused: a player-safe share of a map `playerSafeRefusal` refuses. */
  private async mapPayload(map: MapAccess): Promise<{ payload: SharePayload; images: MapImages; version: string; bytes: ArrayBuffer } | null> {
    if (map.entry.share.mode !== 'full' && playerSafeRefusal(map.source) !== null) return null;
    const images = await hashMapImages(map.source.map, this.sources.images, this.hash, this.dimensions);
    const linked = new Set(map.linked);
    const context = {
      rules: this.sources.rules(), collectionGrid: this.sources.collectionGrid(map.entry.mapPath),
      coneAngle: this.sources.coneAngle(map.entry.mapPath), initiativeRules: this.sources.initiativeRules(map.entry.mapPath), images,
      noteItem: (path: string): string | null => (linked.has(path) ? this.items.idFor(path) : null),
      linked: map.linked.map((path) => this.items.idFor(path)),
      isFile: (path: string): boolean => this.sources.isFile(path),
    };
    const built = map.entry.share.mode === 'full'
      ? fullPayload(map.source, map.entry.name, context)
      : playerSafePayload(map.source, map.entry.name, context);
    if (!built) return null;
    const bytes = utf8(JSON.stringify(built));
    const version = await this.hash(bytes);
    return { payload: { kind: 'map', bytes, version }, images, version, bytes };
  }

  private async image(access: Access, mapItem: string, fingerprint: string): Promise<SharePayload | null> {
    const map = access.maps.find((candidate) => candidate.entry.share.item === mapItem);
    if (!map) return null;
    const built = await this.mapPayload(map);
    if (!built) return null;
    const { payload, images } = built;
    const sent: { images: string[] } = JSON.parse(new TextDecoder().decode(payload.bytes)) as { images: string[] };
    if (!sent.images.includes(fingerprint)) return null;
    const path = [...images.fingerprints].find(([, id]) => id === fingerprint)?.[0];
    const mime = path ? mimeForPath(path) : null;
    if (!path || !mime) return null;
    const bytes = await this.sources.images.read(path);
    return (await this.hash(bytes)) === fingerprint ? { kind: 'image', bytes, version: fingerprint, mime } : null;
  }
}
