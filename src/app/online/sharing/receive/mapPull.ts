/**
 * Adds a pulled map to the `Shared with me` collection with one `scenes.addToCollection`: Atlas writes its images,
 * the map file and the scene record under its asset index lock, and on failure leaves nothing behind. Each image is
 * checked against its fingerprint by the transfer and again here, since the fingerprint names its file; one saved
 * by an earlier pull from the same person is used again by its vault path. A re-pull of a map changed here asks
 * Keep both or Take theirs.
 *
 * Atlas cannot replace a scene's map yet, so the newer version always arrives as a new scene (`installUpdate`):
 * with Take theirs later pulls follow the new one, with Keep both they keep following the first.
 */
import type { App } from 'obsidian';
import type { ScenesApi } from '@atlas-vtt/api-types';
import { ASSET_MIMES, extensionForMime } from '../../assets/assetIds';
import type { MapPayload } from '../model/mapPayload';
import type { CatalogueItem } from '../model/SenderCatalogue';
import type { PulledItem } from '../transport/ShareNode';
import type { PullOutcome } from './notePull';
import type { PulledItems, PulledRecord } from './PulledItems';
import { receivedMapInput } from './receivedMap';
import { isInside, safeFileName } from './safePaths';
import { fileAt } from './vaultFiles';

export const SHARED_COLLECTION = 'Shared with me';
/** Atlas's folder of collections (`atlas-vtt/collections/<id>`), which `addToCollection` writes inside. */
const COLLECTIONS_DIR = 'atlas-vtt/collections';
const IMAGES_DIR = 'files';

export interface MapPullDeps {
  app: App;
  scenes: Pick<ScenesApi, 'addToCollection' | 'list'>;
  pulled: PulledItems;
  /** Pulls one image of the map by fingerprint (checked by the transfer). */
  pullImage(fingerprint: string): Promise<PulledItem>;
  /** The map's linked notes the receiver ticked in this pull: item id → vault path. */
  notes: ReadonlyMap<string, string>;
  /** The received map changed here since the last pull. */
  confirmUpdate(title: string): Promise<'both' | 'theirs' | null>;
  now?: () => number;
}

export interface MapPullInput {
  tableId: string;
  from: string;
  personName: string;
  item: CatalogueItem;
  payload: MapPayload;
}

interface Upload {
  /** Fingerprint → how the map names the image (`ReceivedMapContext.images`). */
  names: Map<string, string>;
  images: Array<{ path: string; data: ArrayBuffer }>;
}

/** The collection's id: the one a scene of it already has (Atlas matches names without case), else the name it is created with. */
async function sharedCollectionId(scenes: MapPullDeps['scenes']): Promise<string> {
  const wanted = SHARED_COLLECTION.toLowerCase();
  return (await scenes.list()).find((scene) => scene.collectionId.toLowerCase() === wanted)?.collectionId ?? SHARED_COLLECTION;
}

/** Notes of the map the receiver pulled in earlier pulls, whose files are still there; this pull's ticked notes win. */
function linkedNotes(deps: MapPullDeps, input: MapPullInput): Map<string, string> {
  const notes = new Map<string, string>();
  for (const id of input.payload.notes) {
    const record = deps.pulled.get(input.tableId, input.from, id);
    if (record && record.kind === 'note' && fileAt(deps.app, record.path)) notes.set(id, record.path);
  }
  for (const [id, path] of deps.notes) notes.set(id, path);
  return notes;
}

async function pullImages(deps: MapPullDeps, folder: string, fingerprints: readonly string[]): Promise<Upload> {
  const upload: Upload = { names: new Map(), images: [] };
  for (const fingerprint of fingerprints) {
    const existing = ASSET_MIMES.map((mime) => `${folder}/${IMAGES_DIR}/${fingerprint}.${extensionForMime(mime)}`).find((path) => fileAt(deps.app, path));
    if (existing) {
      upload.names.set(fingerprint, existing);
      continue;
    }
    // An image that cannot be pulled is skipped like one with the wrong bytes: the map still arrives, without it.
    const image = await deps.pullImage(fingerprint).catch(() => null);
    if (!image) continue;
    // The transfer checked the bytes against the fingerprint asked for; it is checked here again, since this is what names the file.
    if (!image.mime || image.version !== fingerprint || upload.names.has(fingerprint)) continue;
    const path = `${IMAGES_DIR}/${fingerprint}.${extensionForMime(image.mime)}`;
    if (!isInside(`${folder}/${path}`, folder)) continue;
    upload.names.set(fingerprint, path);
    upload.images.push({ path, data: image.bytes });
  }
  return upload;
}

/** The newer version as a new scene: `follow` moves the record onto it (Take theirs), else it stays on the first (Keep both). */
async function installUpdate(deps: MapPullDeps, add: () => Promise<{ mapPath: string; text: string; sceneId: string }>, known: PulledRecord, follow: boolean, version: string): Promise<PullOutcome> {
  const added = await add();
  if (!follow) return { kind: 'both', path: added.mapPath };
  const record = deps.pulled.update(known.key, { path: added.mapPath, sceneId: added.sceneId, version, pulledAt: (deps.now ?? Date.now)() }) ?? known;
  await deps.pulled.writeBase(record, added.text);
  return { kind: 'updated', path: added.mapPath };
}

/** Connect's own pulls one at a time: which images are already saved is decided right before Atlas writes the others. */
let writing: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = writing.then(task);
  writing = run.catch(() => undefined);
  return run;
}

export function pullMap(deps: MapPullDeps, input: MapPullInput): Promise<PullOutcome> {
  return oneAtATime(() => writeMap(deps, input));
}

async function writeMap(deps: MapPullDeps, input: MapPullInput): Promise<PullOutcome> {
  const { app, scenes, pulled } = deps;
  await pulled.ready();
  const collection = await sharedCollectionId(scenes);
  const folder = `${COLLECTIONS_DIR}/${collection}/scenes/${safeFileName(input.personName, 'Someone')}`;
  const upload = await pullImages(deps, folder, input.payload.images);
  const map = receivedMapInput(input.payload, { images: upload.names, notes: linkedNotes(deps, input), isFile: (path) => path.length < 1024 && fileAt(app, path) !== null });
  const add = async (): Promise<{ mapPath: string; text: string; sceneId: string }> => {
    // Atlas checks that the folder lies inside the collection's and every image inside the folder, and names the file itself.
    const added = await scenes.addToCollection({ collection: { name: SHARED_COLLECTION }, name: safeFileName(input.payload.name), folder, map, images: upload.images });
    const file = fileAt(app, added.mapPath);
    // The base is the text Atlas wrote, so "changed here" compares with what Atlas saved.
    return { ...added, text: file ? await app.vault.read(file) : '' };
  };
  const known = pulled.get(input.tableId, input.from, input.item.item);
  const knownFile = known ? fileAt(app, known.path) : null;
  if (known && knownFile) {
    const base = await pulled.readBase(known);
    const changedHere = base !== null && (await app.vault.read(knownFile)) !== base;
    const choice = changedHere ? await deps.confirmUpdate(input.item.title) : 'theirs';
    if (choice === null) return { kind: 'cancelled' };
    return installUpdate(deps, add, known, choice === 'theirs', input.item.version);
  }
  const added = await add();
  const record = pulled.put({
    tableId: input.tableId, from: input.from, item: input.item.item, kind: 'map', path: added.mapPath, version: input.item.version,
    pulledAt: (deps.now ?? Date.now)(), sceneId: added.sceneId, ...(known ? { baseKey: known.baseKey } : {}),
  });
  await pulled.writeBase(record, added.text);
  return { kind: 'created', path: added.mapPath };
}
