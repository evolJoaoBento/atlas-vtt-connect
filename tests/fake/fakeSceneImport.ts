import { normalizePath } from 'obsidian';
import type { ScenesApi } from '@atlas-vtt/api-types';
import { checkedSceneFields, isPlainRelative, withImagePaths } from './fakeMapFields';
import { savedMapText } from './fakeSavedMap';

/**
 * `scenes.addToCollection` as Atlas does it (`src/api/sceneImport.ts` at api-pr-13-end): everything is checked before
 * the first write, the optional fields of 1.13.0 too (`checkedSceneFields`); images go to `folder/path` and the strings
 * of the scene's own parts naming them become those vault paths (never a pin's `notePath`); the index notes the
 * extension that added the scene and the images it wrote (`createdBy`, `createdImages`, for `replaceMap`); the map file
 * is `savedMapText` under a free name (`collectionFolderName` stem, numbered past files in the folder and paths the
 * index names); a failure after the first write removes what this call wrote, last first: the record it added (only
 * that one), its files, the folder it created and the collection it created.
 */

export type AddInput = Parameters<ScenesApi['addToCollection']>[0];

/** The index and vault the import works on (the fake's). */
export interface ImportTarget {
  files: Map<string, string>;
  folders: Set<string>;
  /** Collection id → name. */
  collections: Map<string, string>;
  /** Scene id → map path, of every record in the index. */
  scenes(): Map<string, string | null>;
  addRecord(name: string, collectionId: string, mapPath: string, created: { createdBy: string; createdImages: string[] }): string;
  removeRecord(sceneId: string): void;
  /** A test's planned failure: after the writes, or after the record was added (the index save failing). */
  takeFailure(): { error: Error; after: 'writes' | 'record' } | null;
}

const COLLECTIONS_DIR = 'atlas-vtt/collections';
const INVALID_NAME_CHARACTERS = /[\\/:*?"<>|#^[\]]/;

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function collectionNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name';
  if (INVALID_NAME_CHARACTERS.test(trimmed)) return 'Collection names cannot contain \\ / : * ? " < > | # ^ [ or ]';
  if (trimmed.startsWith('.')) return 'Collection names cannot start with a dot';
  return null;
}

function collectionFolderName(name: string): string {
  return name.trim().replace(new RegExp(INVALID_NAME_CHARACTERS.source, 'g'), '-').replace(/^\.+/, '').trim() || 'Collection';
}

function resolveCollection(target: ImportTarget, ref: AddInput['collection']): { id: string; created: boolean } {
  if ('id' in ref) {
    if (!target.collections.has(ref.id)) throw new Error(`[Atlas API] There is no collection with the id "${String(ref.id)}".`);
    return { id: ref.id, created: false };
  }
  const problem = typeof ref.name === 'string' ? collectionNameProblem(ref.name) : 'Enter a name';
  if (problem) throw new Error(`[Atlas API] The collection name cannot be used: ${problem}`);
  const key = ref.name.trim().toLowerCase();
  const match = [...target.collections].find(([id, name]) => id.toLowerCase() === key || name.toLowerCase() === key);
  if (match) return { id: match[0], created: false };
  const id = ref.name.trim();
  // As Atlas's `assertCollectionFolderName`: a folder of that name (ignoring case) that no collection indexes is in the way.
  const folderKey = id.toLocaleLowerCase();
  const taken = [...target.folders, ...target.files.keys()].some((path) => path.startsWith(`${COLLECTIONS_DIR}/`)
    && !path.slice(COLLECTIONS_DIR.length + 1).includes('/') && path.slice(COLLECTIONS_DIR.length + 1).trim().toLocaleLowerCase() === folderKey);
  if (taken) throw new Error(`A folder named "${id}" already exists in the collections folder`);
  target.collections.set(id, id);
  return { id, created: true };
}

function freeMapPath(target: ImportTarget, folder: string, name: string): string {
  const prefix = `${folder.toLowerCase()}/`;
  const taken = new Set<string>();
  for (const path of [...target.files.keys(), ...target.folders]) {
    if (path.toLowerCase().startsWith(prefix) && !path.slice(prefix.length).includes('/')) taken.add(path.slice(prefix.length).toLowerCase());
  }
  for (const path of target.scenes().values()) if (path?.toLowerCase().startsWith(prefix)) taken.add(path.slice(prefix.length).toLowerCase());
  const stem = collectionFolderName(name);
  let file = `${stem}.atlasmap`;
  for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${stem} (${n}).atlasmap`;
  return `${folder}/${file}`;
}

const exists = (target: ImportTarget, path: string): boolean => target.files.has(path) || target.folders.has(path);

export function importScene(target: ImportTarget, input: AddInput, owner: string): { sceneId: string; mapPath: string } {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || !input.map || !Array.isArray(input.images)) {
    throw new Error('[Atlas API] addToCollection needs { collection, name, folder, map, images }.');
  }
  const collection = resolveCollection(target, input.collection);
  const known = new Set(target.scenes().keys());
  const written: string[] = [];
  let createdFolder: string | null = null;
  let mapPath = '';
  try {
    const folder = typeof input.folder === 'string' ? normalizePath(input.folder) : '';
    if (!isPlainRelative(folder) || !`${folder}/x`.startsWith(`${COLLECTIONS_DIR}/${collection.id}/`)) {
      throw new Error(`[Atlas API] The folder must lie inside the collection's folder, ${COLLECTIONS_DIR}/${collection.id}.`);
    }
    const fields = checkedSceneFields(input.map);
    const targets = new Map<string, ArrayBuffer>();
    for (const image of input.images) {
      const path: unknown = image?.path;
      if (!isPlainRelative(path) || !normalizePath(`${folder}/${path}`).startsWith(`${normalizePath(folder)}/`)) throw new Error(`[Atlas API] The image path "${String(path)}" must stay inside the folder.`);
      const at = `${folder}/${path}`;
      if (targets.has(at) || exists(target, at)) throw new Error(`[Atlas API] There is already a file at ${at}.`);
      targets.set(at, image.data);
    }
    const parts = folder.split('/');
    createdFolder = parts.map((_, length) => parts.slice(0, length + 1).join('/')).find((path) => !exists(target, path)) ?? null;
    for (let path = folder; path && !target.folders.has(path); path = parentOf(path)) target.folders.add(path);
    for (const [at, data] of targets) {
      written.push(at);
      target.files.set(at, new TextDecoder().decode(data));
    }
    mapPath = freeMapPath(target, folder, input.name);
    const imagePaths = new Map([...targets.keys()].map((at) => [at.slice(folder.length + 1), at]));
    written.push(mapPath);
    target.files.set(mapPath, savedMapText(withImagePaths(input.map, imagePaths), mapPath, input.name.trim(), fields));
    const failure = target.takeFailure();
    if (failure?.after === 'writes') throw failure.error;
    const sceneId = target.addRecord(input.name.trim(), collection.id, mapPath, { createdBy: owner, createdImages: [...targets.keys()] });
    if (failure?.after === 'record') throw failure.error;
    return { sceneId, mapPath };
  } catch (error) {
    // Only a record this call added: one that was in the index before, even at this path, is not ours to delete.
    if (mapPath) for (const [id, path] of target.scenes()) if (!known.has(id) && path === mapPath) target.removeRecord(id);
    for (const path of [...written].reverse()) target.files.delete(path);
    if (createdFolder) {
      const dir = createdFolder;
      for (const path of [...target.folders]) if (path === dir || path.startsWith(`${dir}/`)) target.folders.delete(path);
      for (const path of [...target.files.keys()]) if (path.startsWith(`${dir}/`)) target.files.delete(path);
    }
    if (collection.created) target.collections.delete(collection.id);
    throw error;
  }
}
