/**
 * A map share's ticked notes are vault paths, so they follow the vault: a renamed or moved note stays
 * ticked under its new path, and a deleted one is unticked (a new file at the old path is never shared by accident).
 */
import type { ScenesApi } from '@atlas-vtt/api-types';
import { pathWithin } from '../pathRenames';
import { mapShareOf, writeMapShare } from './mapShare';

export type VaultChange = { rename: readonly [string, string] } | { removed: string };

function moved(paths: readonly string[], change: VaultChange): string[] {
  if ('removed' in change) return paths.filter((path) => !pathWithin(path, change.removed));
  const [from, to] = change.rename;
  return paths.map((path) => (pathWithin(path, from) ? to + path.slice(from.length) : path));
}

/** Brings the ticked notes of every shared map in step with `change`. */
export async function followVaultChange(scenes: Pick<ScenesApi, 'list' | 'getData' | 'setData'>, change: VaultChange): Promise<void> {
  for (const scene of await scenes.list()) {
    // The share is read for each scene in turn, and Atlas re-reads the record before writing (`setData`): a rename
    // also updates the scene's map path, and the write must not undo it (F-b).
    const share = await mapShareOf(scenes, scene.id);
    if (!share) continue;
    const notes = moved(share.notes, change);
    if (notes.length === share.notes.length && notes.every((path, at) => path === share.notes[at])) continue;
    await writeMapShare(scenes, scene.id, { ...share, notes });
  }
}
