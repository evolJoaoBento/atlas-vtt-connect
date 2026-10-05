/**
 * Vault paths that follow renames and deletions, for the records sharing keeps by path (the
 * sender's note ids, the receiver's pulled notes). A path is inside a folder when it is the folder
 * or lies below it; renames carry every path below a moved folder along.
 */

/** Whether `path` is `folder` or lies below it. */
export function pathWithin(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/** `record` with every key at or below `from` moved to `to`; null when no key was affected. */
export function renamePrefix<T>(record: Readonly<Record<string, T>>, from: string, to: string): Record<string, T> | null {
  let changed = false;
  const moved = Object.fromEntries(Object.entries(record).map(([path, value]): [string, T] => {
    if (!pathWithin(path, from)) return [path, value];
    changed = true;
    return [to + path.slice(from.length), value];
  }));
  return changed ? moved : null;
}

/** `record` without the keys at or below `path`; null when no key was affected. */
export function removeWithin<T>(record: Readonly<Record<string, T>>, path: string): Record<string, T> | null {
  const kept = Object.entries(record).filter(([key]) => !pathWithin(key, path));
  return kept.length === Object.keys(record).length ? null : Object.fromEntries(kept);
}
