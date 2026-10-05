/**
 * What this Atlas pulled from whom, in `pulled.json`, with the last pulled text of each note
 * (the merge base) in `bases/<key>.md`. All in Connect's sharing data (`sharingPaths`), never in the vault.
 * Follows renames of the pulled files.
 */
import type { App } from 'obsidian';
import { randomId } from '../../ids';
import { JsonDataFile, readText, writeText, type DataAdapterLike } from '../dataFile';
import { pathWithin } from '../pathRenames';
import type { SharingPaths } from '../sharingPaths';

export type PulledPaths = Pick<SharingPaths, 'pulled' | 'bases'>;

export type UpdateChoice = 'both' | 'mine' | 'theirs' | 'resolve' | 'auto';
export type ConflictDefault = 'mine' | 'theirs' | 'both';

export interface PulledRecord {
  /** `<tableId>/<from>/<item>`. */
  key: string;
  tableId: string;
  from: string;
  item: string;
  kind: 'note' | 'map';
  /** The vault file it was written to; empty once that file was deleted. */
  path: string;
  /** The sender's version last pulled. */
  version: string;
  baseKey: string;
  pulledAt: number;
  sceneId?: string;
  /** "Remember for this note". */
  choice?: UpdateChoice;
  conflictDefault?: ConflictDefault;
  /** Auto merges are saved without showing them. */
  silent?: boolean;
}

interface PulledData {
  version: 1;
  records: PulledRecord[];
}

const CHOICES: readonly UpdateChoice[] = ['both', 'mine', 'theirs', 'resolve', 'auto'];
const DEFAULTS: readonly ConflictDefault[] = ['mine', 'theirs', 'both'];

function parseRecord(value: unknown): PulledRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Record<string, unknown>;
  const strings = ['key', 'tableId', 'from', 'item', 'version', 'baseKey'] as const;
  const text = (field: string): boolean => {
    const v = r[field];
    return typeof v === 'string' && v.length > 0 && v.length <= 1024;
  };
  // A path is empty once its file was deleted: the record stays for its base, but owns no file.
  if (!strings.every(text) || typeof r.path !== 'string' || r.path.length > 1024) return null;
  if (r.kind !== 'note' && r.kind !== 'map') return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(r.baseKey as string)) return null;
  return {
    key: r.key as string, tableId: r.tableId as string, from: r.from as string, item: r.item as string, kind: r.kind,
    path: r.path, version: r.version as string, baseKey: r.baseKey as string,
    pulledAt: typeof r.pulledAt === 'number' ? r.pulledAt : 0,
    ...(typeof r.sceneId === 'string' ? { sceneId: r.sceneId } : {}),
    ...(CHOICES.includes(r.choice as UpdateChoice) ? { choice: r.choice as UpdateChoice } : {}),
    ...(DEFAULTS.includes(r.conflictDefault as ConflictDefault) ? { conflictDefault: r.conflictDefault as ConflictDefault } : {}),
    ...(r.silent === true ? { silent: true } : {}),
  };
}

function parsePulled(value: unknown): PulledData {
  const records = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).records : null;
  return { version: 1, records: Array.isArray(records) ? records.flatMap((entry) => parseRecord(entry) ?? []) : [] };
}

export class PulledItems {
  private static readonly instances = new WeakMap<App, Map<string, PulledItems>>();
  /** One per vault and data folder, so every binding of the same Atlas reads one record of what was pulled. */
  static forApp(app: App, paths: PulledPaths): PulledItems {
    let byPath = this.instances.get(app);
    if (!byPath) {
      byPath = new Map();
      this.instances.set(app, byPath);
    }
    let items = byPath.get(paths.pulled);
    if (!items) {
      items = PulledItems.create(app.vault.adapter, paths);
      byPath.set(paths.pulled, items);
    }
    return items;
  }

  static create(adapter: DataAdapterLike, paths: PulledPaths): PulledItems {
    return new PulledItems(adapter, new JsonDataFile(adapter, paths.pulled, parsePulled), paths.bases);
  }

  static keyOf(tableId: string, from: string, item: string): string {
    return `${tableId}/${from}/${item}`;
  }

  private records: PulledRecord[] = [];
  /** Records put or renamed before the stored file was read are applied on top of it. */
  private loading: Promise<void> | null = null;
  private loaded = false;
  private unsaved = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly adapter: DataAdapterLike, private readonly file: JsonDataFile<PulledData>, private readonly basesDir: string) {}

  ready(): Promise<void> {
    this.loading ??= this.file.load().then((data) => {
      const known = new Set(this.records.map((record) => record.key));
      this.records = [...data.records.filter((record) => !known.has(record.key)), ...this.records];
      this.loaded = true;
      if (this.unsaved) void this.file.save({ version: 1, records: this.records });
    });
    return this.loading;
  }

  get(tableId: string, from: string, item: string): PulledRecord | null {
    const key = PulledItems.keyOf(tableId, from, item);
    return this.records.find((record) => record.key === key) ?? null;
  }

  byPath(path: string): PulledRecord | null {
    return this.records.find((record) => record.path === path) ?? null;
  }

  /** Whether some record owns `path` (compared without case, as file systems do). */
  holds(path: string): boolean {
    const lower = path.toLowerCase();
    return this.records.some((record) => record.path !== '' && record.path.toLowerCase() === lower);
  }

  list(): readonly PulledRecord[] {
    return this.records;
  }

  /** A new record (or one replacing the record with the same key); a new base key when it has none. */
  put(record: Omit<PulledRecord, 'key' | 'baseKey'> & { baseKey?: string }): PulledRecord {
    const key = PulledItems.keyOf(record.tableId, record.from, record.item);
    const full: PulledRecord = { ...record, key, baseKey: record.baseKey ?? randomId() };
    this.records = [...this.records.filter((known) => known.key !== key), full];
    this.changed();
    return full;
  }

  update(key: string, changes: Partial<Omit<PulledRecord, 'key' | 'baseKey'>>): PulledRecord | null {
    const record = this.records.find((known) => known.key === key);
    if (!record) return null;
    const updated = { ...record, ...changes };
    this.records = this.records.map((known) => (known === record ? updated : known));
    this.changed();
    return updated;
  }

  /** Clears "Remember for this note" (the choice and the silent flag), so the next update asks again; false when nothing was remembered. */
  forgetChoice(key: string): boolean {
    const record = this.records.find((known) => known.key === key);
    if (!record || (record.choice === undefined && record.silent === undefined)) return false;
    const { choice: _choice, silent: _silent, ...rest } = record;
    this.records = this.records.map((known) => (known === record ? rest : known));
    this.changed();
    return true;
  }

  readBase(record: PulledRecord): Promise<string | null> {
    return readText(this.adapter, `${this.basesDir}/${record.baseKey}.md`);
  }

  writeBase(record: PulledRecord, text: string): Promise<void> {
    return writeText(this.adapter, `${this.basesDir}/${record.baseKey}.md`, text);
  }

  /** The pulled files at or below `from` now live at `to`. */
  renamed(from: string, to: string): void {
    let changed = false;
    this.records = this.records.map((record) => {
      if (!pathWithin(record.path, from)) return record;
      changed = true;
      return { ...record, path: to + record.path.slice(from.length) };
    });
    if (changed) this.changed();
  }

  /** The files at or below `path` were deleted: their records keep their bases but own no file, so no later file is taken for theirs. */
  deleted(path: string): void {
    let changed = false;
    this.records = this.records.map((record) => {
      if (record.path === '' || !pathWithin(record.path, path)) return record;
      changed = true;
      return { ...record, path: '' };
    });
    if (changed) this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Saves only once the stored file was read, so a save never replaces records not yet loaded. */
  private changed(): void {
    if (this.loaded) void this.file.save({ version: 1, records: this.records });
    else this.unsaved = true;
    this.listeners.forEach((listener) => listener());
  }
}
