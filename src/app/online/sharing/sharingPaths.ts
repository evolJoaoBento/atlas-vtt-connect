/** Where Connect keeps its sharing data, inside the folder Atlas gives the extension (`storage.folder()`). */
export interface SharingPaths {
  root: string;
  people: string;
  items: string;
  pulled: string;
  /** The last pulled text of each pulled note, the base of its next merge. */
  bases: string;
  history: string;
}

/** The sharing data paths under `storageFolder`, e.g. `atlas-vtt/.atlas-data/extensions/atlas-vtt-connect`. */
export function sharingPaths(storageFolder: string): SharingPaths {
  const root = `${storageFolder}/sharing`;
  return { root, people: `${root}/people.json`, items: `${root}/items.json`, pulled: `${root}/pulled.json`, bases: `${root}/bases`, history: `${root}/history` };
}
