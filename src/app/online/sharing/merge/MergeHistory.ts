/**
 * Each pulled note's merge history, in `history/<base key>.json` in Connect's sharing data: the
 * text every merge or Take theirs replaced, newest last, at most 20 and about 10 MiB. Undo restores the newest.
 */
import type { App } from 'obsidian';
import { readText, removeFile, writeText, type DataAdapterLike } from '../dataFile';
import type { PulledRecord } from '../receive/PulledItems';
import { fileAt } from '../receive/vaultFiles';

export interface MergeEntry {
  at: number;
  before: string;
  after: string;
}

export const MAX_MERGE_ENTRIES = 20;
/** A note's history may hold this much text (characters of before and after); the oldest entries go first, the newest always stays. */
export const MAX_HISTORY_CHARS = 10 * 1024 * 1024;

const sizeOf = (entry: MergeEntry): number => entry.before.length + entry.after.length;

function parseEntries(text: string | null): MergeEntry[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((entry): entry is MergeEntry => typeof entry === 'object' && entry !== null
        && typeof (entry as MergeEntry).before === 'string' && typeof (entry as MergeEntry).after === 'string'
        && typeof (entry as MergeEntry).at === 'number')
      : [];
  } catch {
    return [];
  }
}

export class MergeHistory {
  /** `folder` is the sharing data's history folder (`SharingPaths.history`). */
  constructor(private readonly adapter: DataAdapterLike, private readonly folder: string) {}

  async entries(record: PulledRecord): Promise<MergeEntry[]> {
    return parseEntries(await readText(this.adapter, this.path(record)));
  }

  async add(record: PulledRecord, entry: MergeEntry): Promise<void> {
    const entries = [...(await this.entries(record)), entry].slice(-MAX_MERGE_ENTRIES);
    let total = entries.reduce((sum, known) => sum + sizeOf(known), 0);
    while (entries.length > 1 && total > MAX_HISTORY_CHARS) total -= sizeOf(entries.shift()!);
    await writeText(this.adapter, this.path(record), JSON.stringify(entries));
  }

  async pop(record: PulledRecord): Promise<MergeEntry | null> {
    const entries = await this.entries(record);
    const last = entries.pop() ?? null;
    if (entries.length > 0) await writeText(this.adapter, this.path(record), JSON.stringify(entries));
    else await removeFile(this.adapter, this.path(record));
    return last;
  }

  /** Forgets the whole history of `record`. */
  async clear(record: PulledRecord): Promise<void> {
    await removeFile(this.adapter, this.path(record));
  }

  private path(record: PulledRecord): string {
    return `${this.folder}/${record.baseKey}.json`;
  }
}

export type UndoOutcome = 'undone' | 'declined' | 'nothing';

/**
 * Restores the text the last merge replaced, in the file the record owns (a record whose file
 * was deleted owns none, so nothing is touched). Asks first when the note changed since;
 * `declined` when the receiver said no.
 */
export async function undoLastMerge(app: App, history: MergeHistory, record: PulledRecord, confirmChanged: () => Promise<boolean>): Promise<UndoOutcome> {
  const last = (await history.entries(record)).at(-1);
  const file = fileAt(app, record.path);
  if (!last || !file) return 'nothing';
  if ((await app.vault.read(file)) !== last.after && !(await confirmChanged())) return 'declined';
  await app.vault.process(file, () => last.before);
  await history.pop(record);
  return 'undone';
}
