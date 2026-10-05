/**
 * Synced marks about table keys, kept in `data.json` beside the settings; neither holds anything secret (table ids
 * are public, carried in join links). They stop a key from reaching a device it should not:
 * - `forkTableKeyTaken`: the id of the preview's settings-file key, once one device took it. Other devices then make
 *   their own table, as the preview's per-device rule does (its local key on a device may still be taken there).
 * - `retiredTableIds`: tables replaced with New table key; a key with one of these ids is never taken, from any source.
 */
export const RETIRED_TABLE_LIMIT = 20;

export interface TableMarks {
  forkTableKeyTaken: string | null;
  retiredTableIds: string[];
}

const isTableId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

/** The marks from stored data of any shape; malformed ones are none. */
export function readTableMarks(data: { forkTableKeyTaken?: unknown; retiredTableIds?: unknown }): TableMarks {
  return {
    forkTableKeyTaken: isTableId(data.forkTableKeyTaken) ? data.forkTableKeyTaken : null,
    retiredTableIds: Array.isArray(data.retiredTableIds) ? data.retiredTableIds.filter(isTableId).slice(-RETIRED_TABLE_LIMIT) : [],
  };
}

/** `ids` with `id` retired last, the oldest dropped past the limit. */
export function retired(ids: readonly string[], id: string): string[] {
  return [...ids.filter((each) => each !== id), id].slice(-RETIRED_TABLE_LIMIT);
}

/** The marks as `data.json` keeps them: only those set. */
export function storedTableMarks(marks: TableMarks): { forkTableKeyTaken?: string; retiredTableIds?: string[] } {
  return {
    ...(marks.forkTableKeyTaken ? { forkTableKeyTaken: marks.forkTableKeyTaken } : {}),
    ...(marks.retiredTableIds.length > 0 ? { retiredTableIds: [...marks.retiredTableIds] } : {}),
  };
}
