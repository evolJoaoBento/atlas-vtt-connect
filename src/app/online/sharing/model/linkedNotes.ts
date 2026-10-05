/** The notes a map links to: notes of pins and tokens, and statblocks. Hidden: only behind GM-only pins or hidden tokens. */
import type { SharedMapFile } from './sharedMapFile';
import type { MapShareMode } from './mapShare';

export interface LinkedNote {
  path: string;
  label: string;
  /** Every reference to it is a GM-only pin or a hidden token. */
  hidden: boolean;
}

const labelOf = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '');

export function linkedNotesOf(map: SharedMapFile): LinkedNote[] {
  const notes = new Map<string, LinkedNote>();
  const add = (path: string | undefined, hidden: boolean): void => {
    if (!path) return;
    const known = notes.get(path);
    notes.set(path, { path, label: labelOf(path), hidden: (known?.hidden ?? true) && hidden });
  };
  // Truthy hides, as the projection (`projectForPlayers`) and the payload (`playerSafePayload`) read it.
  for (const pin of Object.values(map.objects.pins)) add(pin.notePath, Boolean(pin.gmOnly));
  for (const token of Object.values(map.objects.tokens)) {
    const hidden = Boolean(token.isHidden);
    if ('notePath' in token) add(token.notePath, hidden);
    if ('statblockPath' in token) add(token.statblockPath, hidden);
  }
  return [...notes.values()];
}

/** What the dialog offers: a player-safe share never offers notes only GM-only pins or hidden tokens link to. */
export function offeredNotes(map: SharedMapFile, mode: MapShareMode): LinkedNote[] {
  const all = linkedNotesOf(map);
  return mode === 'full' ? all : all.filter((note) => !note.hidden);
}
