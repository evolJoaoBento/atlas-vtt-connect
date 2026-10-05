/**
 * The receiver's side of one share session: lists what each person shares with this Atlas,
 * marks items new, updated or up to date against what was pulled, and pulls on request.
 * Listing writes nothing; only `pull` (and `pullPushed`, from a push the receiver accepted) do.
 * Every pull passes the version it listed, so the bytes must be what the receiver was shown. A note's
 * forwarded tags are then written with this Atlas's names for those people, before anything is saved.
 */
import type { App } from 'obsidian';
import { localizeForwardedTags } from '../model/forwardedParts';
import { parseMapPayload } from '../model/mapPayload';
import type { CatalogueItem } from '../model/SenderCatalogue';
import type { PushRequest } from '../shareSessionStore';
import { ShareError, type ShareNode } from '../transport/ShareNode';
import { pullMap, type MapPullDeps } from './mapPull';
import { pullNote, type NoteUpdatePolicy, type PullOutcome } from './notePull';
import type { PulledItems, PulledRecord } from './PulledItems';

export type ItemState = 'new' | 'updated' | 'current';

export interface ListedItem extends CatalogueItem {
  state: ItemState;
}

export interface PersonCatalogue {
  personId: string;
  items: ListedItem[];
}

export interface SharedWithMeDeps {
  app: App;
  pulled: PulledItems;
  node: Pick<ShareNode, 'requestList' | 'pull'>;
  tableId: string;
  policy: NoteUpdatePolicy;
  /** The name of a person in this Atlas's people list (their folder's name). */
  nameOf: (personId: string) => string;
  /**
   * The name this Atlas's people list has for a person of this table, null when it does not know them:
   * what the tags of a pulled note name them as (`peopleListNames` in `forwardedParts.ts`).
   */
  nameAt: (personId: string) => string | null;
  scenes: MapPullDeps['scenes'];
  confirmMapUpdate: (title: string) => Promise<'both' | 'theirs' | null>;
  replaced?: (record: PulledRecord, before: string, after: string) => Promise<void>;
  rehomed?: (record: PulledRecord) => Promise<void>;
}

const decode = (bytes: ArrayBuffer): string => new TextDecoder().decode(bytes);

export class SharedWithMe {
  private readonly lists = new Map<string, CatalogueItem[]>();

  constructor(private readonly deps: SharedWithMeDeps) {}

  async refresh(personId: string): Promise<PersonCatalogue> {
    await this.deps.pulled.ready();
    const items = await this.deps.node.requestList(personId);
    this.lists.set(personId, items);
    return { personId, items: items.map((item) => ({ ...item, state: this.stateOf(personId, item) })) };
  }

  stateOf(personId: string, item: CatalogueItem): ItemState {
    const record = this.deps.pulled.get(this.deps.tableId, personId, item.item);
    if (!record) return 'new';
    return record.version === item.version ? 'current' : 'updated';
  }

  /** Pulls one item; for a map, `linked` are the linked notes the receiver ticked (pulled first, so its pins point at them). */
  async pull(personId: string, item: CatalogueItem, linked: readonly string[] = []): Promise<PullOutcome> {
    const { node, tableId } = this.deps;
    const personName = this.deps.nameOf(personId);
    const pulled = await node.pull(personId, item.item, item.kind, item.version);
    if (item.kind === 'note') return this.writeNote(personId, personName, item, decode(pulled.bytes));
    const payload = parseMapPayload(JSON.parse(decode(pulled.bytes)) as unknown);
    if (!payload) throw new ShareError('failed');
    const notes = new Map<string, string>();
    const catalogue = this.lists.get(personId) ?? [];
    for (const noteItem of linked.filter((id) => payload.notes.includes(id))) {
      const listed = catalogue.find((candidate) => candidate.item === noteItem && candidate.kind === 'note');
      if (!listed) continue;
      const note = await node.pull(personId, noteItem, 'note', listed.version);
      const outcome = await this.writeNote(personId, personName, listed, decode(note.bytes));
      if ('path' in outcome) notes.set(noteItem, outcome.path);
    }
    return pullMap({
      app: this.deps.app, scenes: this.deps.scenes, pulled: this.deps.pulled, notes,
      pullImage: (fingerprint) => node.pull(personId, `${item.item}/${fingerprint}`, 'image'),
      confirmUpdate: (title) => this.deps.confirmMapUpdate(title),
    }, { tableId, from: personId, personName, item, payload });
  }

  /** A push the receiver chose to pull: looks the item up in that person's list, then pulls it. */
  async pullPushed(push: PushRequest): Promise<PullOutcome> {
    const listed = (await this.refresh(push.from)).items.find((item) => item.item === push.item);
    // The sender's list decides: a push for an item it does not list for this receiver is one they may not have.
    if (!listed) throw new ShareError('not-shared');
    return this.pull(push.from, listed);
  }

  private writeNote(personId: string, personName: string, item: CatalogueItem, received: string): Promise<PullOutcome> {
    const text = localizeForwardedTags(received, this.deps.tableId, (person) => this.deps.nameAt(person));
    return pullNote(
      {
        app: this.deps.app, pulled: this.deps.pulled, policy: this.deps.policy,
        ...(this.deps.replaced ? { replaced: (record: PulledRecord, before: string, after: string) => this.deps.replaced!(record, before, after) } : {}),
        ...(this.deps.rehomed ? { rehomed: (record: PulledRecord) => this.deps.rehomed!(record) } : {}),
      },
      { tableId: this.deps.tableId, from: personId, personName, item, text },
    );
  }
}
