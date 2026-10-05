/**
 * Brings the fork's sharing folder (people, shares, pulls, merge bases and history) into Connect's. Never destructive:
 * every file is copied, read back and compared before it is put in place, and the fork's folder is left as it was.
 * A run cut short leaves nothing half-made where Connect reads: a first copy waits in a staging folder that is renamed
 * into place only once complete, and a merged file is renamed into place only once verified.
 */
import type { DataAdapter } from 'obsidian';
import { ensureAdapterFolder } from '../app/plugin/vaultFolders';

/** The fork's sharing data, in Atlas's own data folder. */
export const FORK_SHARING_DIR = 'atlas-vtt/.atlas-data/sharing';
export const KEPT_FORK_COPY_NOTICE = "Atlas VTT Connect kept its sharing data and left the preview's copy in atlas-vtt/.atlas-data/sharing. Delete it once you've checked your people and shares.";
/** Added to a copy until it is verified; an interrupted copy is overwritten next time. */
const PENDING = '.migrating';

export type MigrationAdapter = Pick<DataAdapter, 'exists' | 'list' | 'read' | 'readBinary' | 'writeBinary' | 'rename' | 'mkdir' | 'remove' | 'rmdir'>;
export type SharingMigration = 'moved' | 'merged' | 'none';

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** Every file under `folder`, as paths relative to it. */
async function filesUnder(adapter: MigrationAdapter, folder: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const listed = await adapter.list(dir);
    for (const file of listed.files) found.push(file.slice(folder.length + 1));
    for (const sub of listed.folders) await walk(sub);
  };
  await walk(folder);
  return found.sort();
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  return left.every((byte, index) => byte === right[index]);
}

/** Copies byte for byte (whatever the file holds, readable or not) and fails unless the copy reads back the same. */
async function copyVerified(adapter: MigrationAdapter, from: string, to: string): Promise<void> {
  const bytes = await adapter.readBinary(from);
  await ensureAdapterFolder({ vault: { adapter } }, parentOf(to));
  await adapter.writeBinary(to, bytes);
  if (!sameBytes(await adapter.readBinary(to), bytes)) throw new Error(`[Atlas VTT Connect] ${to} did not copy intact; the preview's ${from} is unchanged.`);
}

/** No folder of Connect's yet: everything is copied into a staging folder, which becomes Connect's folder in one rename. */
async function copyAll(adapter: MigrationAdapter, files: readonly string[], target: string): Promise<void> {
  const staging = target + PENDING;
  await ensureAdapterFolder({ vault: { adapter } }, staging);
  for (const file of files) await copyVerified(adapter, `${FORK_SHARING_DIR}/${file}`, `${staging}/${file}`);
  await adapter.rename(staging, target);
}

/** Connect has a folder already: each file it lacks is copied next to its place and renamed in; its own files are kept. */
async function copyMissing(adapter: MigrationAdapter, files: readonly string[], target: string): Promise<number> {
  let copied = 0;
  for (const file of files) {
    const to = `${target}/${file}`;
    if (await adapter.exists(to)) continue;
    await copyVerified(adapter, `${FORK_SHARING_DIR}/${file}`, to + PENDING);
    await adapter.rename(to + PENDING, to);
    copied++;
  }
  return copied;
}

/**
 * `moved` when the fork's files became Connect's folder, `merged` when files Connect lacked were added to its folder
 * (the notice then says the fork's copy is still there), `none` when there was nothing to bring. Rejects when a copy
 * fails; the next run starts again.
 */
export async function migrateSharingFolder(adapter: MigrationAdapter, target: string, notify: (message: string) => void): Promise<SharingMigration> {
  if (!(await adapter.exists(FORK_SHARING_DIR))) return 'none';
  const files = (await filesUnder(adapter, FORK_SHARING_DIR)).filter((file) => !file.endsWith(PENDING));
  if (files.length === 0) return 'none';
  if (!(await adapter.exists(target))) {
    await copyAll(adapter, files, target);
    return 'moved';
  }
  if ((await copyMissing(adapter, files, target)) === 0) return 'none';
  notify(KEPT_FORK_COPY_NOTICE);
  return 'merged';
}

/** Once the step is done: what an interrupted copy left (a staging folder, `.migrating` files) is removed; clutter only, so failures are ignored. */
export async function removePending(adapter: MigrationAdapter, target: string): Promise<void> {
  try {
    if (await adapter.exists(target + PENDING)) await adapter.rmdir(target + PENDING, true);
    if (!(await adapter.exists(target))) return;
    for (const file of await filesUnder(adapter, target)) if (file.endsWith(PENDING)) await adapter.remove(`${target}/${file}`);
  } catch (error) {
    console.error("[Atlas VTT Connect] Could not tidy up after bringing over the preview's sharing data:", error);
  }
}
