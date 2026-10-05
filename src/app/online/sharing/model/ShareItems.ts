/**
 * Random ids for the sender's shared notes, kept in `items.json` in Connect's sharing data (`SharingPaths`), so no
 * path ever leaves the sender and a renamed note keeps its id (and the receiver's updates).
 * Follows the vault's renames (files and folders) and deletions. Nothing is written before the
 * stored list is read: ids made and renames seen meanwhile are applied to it once it arrives, and
 * a stored id always wins, so an id never changes across restarts.
 */
import type { App } from 'obsidian';
import { randomId } from '../../ids';
import { JsonDataFile, type DataAdapterLike } from '../dataFile';
import { removeWithin, renamePrefix } from '../pathRenames';
import type { SharingPaths } from '../sharingPaths';

interface ItemsData {
  version: 1;
  notes: Record<string, string>;
}

type Change = { rename: [from: string, to: string] } | { removed: string };

function parseItems(value: unknown): ItemsData {
  const notes = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).notes : null;
  const entries = typeof notes === 'object' && notes !== null ? Object.entries(notes as Record<string, unknown>) : [];
  return { version: 1, notes: Object.fromEntries(entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /^[A-Za-z0-9_-]{22}$/.test(entry[1]))) };
}

function applied(notes: Record<string, string>, change: Change): Record<string, string> {
  const next = 'rename' in change ? renamePrefix(notes, change.rename[0], change.rename[1]) : removeWithin(notes, change.removed);
  return next ?? notes;
}

export class ShareItems {
  private static readonly instances = new WeakMap<App, Map<string, ShareItems>>();
  /** The one list for this app and file, as `PeopleBook.forApp`: an Atlas reload keeps the ids it handed out. */
  static forApp(app: App, paths: Pick<SharingPaths, 'items'>): ShareItems {
    const lists = this.instances.get(app) ?? new Map<string, ShareItems>();
    this.instances.set(app, lists);
    let items = lists.get(paths.items);
    if (!items) {
      items = ShareItems.create(app.vault.adapter, paths);
      lists.set(paths.items, items);
    }
    return items;
  }

  static create(adapter: DataAdapterLike, paths: Pick<SharingPaths, 'items'>): ShareItems {
    return new ShareItems(new JsonDataFile(adapter, paths.items, parseItems));
  }

  private notes: Record<string, string> = {};
  /** Changes seen before the stored list was read, replayed on it. */
  private unread: Change[] = [];
  private loading: Promise<void> | null = null;
  private loaded = false;

  constructor(private readonly file: JsonDataFile<ItemsData>) {}

  /** Reads the stored list once; ids are handed out before, but nothing is saved until it is read. */
  ready(): Promise<void> {
    this.loading ??= this.file.load().then((data) => {
      let stored = data.notes;
      for (const change of this.unread) stored = applied(stored, change);
      const fresh = Object.entries(this.notes).filter(([path]) => !(path in stored));
      this.notes = { ...Object.fromEntries(fresh), ...stored };
      const changed = this.unread.length > 0 || fresh.length > 0;
      this.unread = [];
      this.loaded = true;
      if (changed) this.save();
    });
    return this.loading;
  }

  idFor(path: string): string {
    const known = this.notes[path];
    if (known) return known;
    const id = randomId();
    this.notes = { ...this.notes, [path]: id };
    this.save();
    return id;
  }

  pathOf(item: string): string | null {
    return Object.entries(this.notes).find(([, id]) => id === item)?.[0] ?? null;
  }

  /** A file or folder moved: every id inside it follows. */
  renamed(from: string, to: string): void {
    this.change({ rename: [from, to] });
  }

  deleted(path: string): void {
    this.change({ removed: path });
  }

  private change(change: Change): void {
    if (!this.loaded) this.unread.push(change);
    const next = applied(this.notes, change);
    if (next === this.notes) return;
    this.notes = next;
    this.save();
  }

  private save(): void {
    if (this.loaded) void this.file.save({ version: 1, notes: this.notes });
  }
}
