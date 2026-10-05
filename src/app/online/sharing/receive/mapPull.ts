/**
 * Adds a pulled map to the `Shared with me` collection with one `scenes.addToCollection`: Atlas writes its images,
 * the map file and the scene record under its asset index lock, and on failure leaves nothing behind. Each image is
 * checked against its fingerprint by the transfer and again here, since the fingerprint names its file; one saved
 * by an earlier pull from the same person is used again by its vault path, also where the fork's online play preview
 * saved it (`<collection>/files/<person>/`), so a map received there is not downloaded again. A re-pull of a map changed here asks
 * Keep both or Take theirs.
 *
 * Atlas cannot replace a scene's map yet, so the newer version always arrives as a new scene (`installUpdate`):
 * with Take theirs later pulls follow the new one, with Keep both they keep following the first.
 */
import type { App, TFile } from 'obsidian';
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
  /** Tells the receiver something the outcome does not say (where an unasked newer version went). */
  notify?(text: string): void;
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

/** Where images from this person are already saved: Connect's folder, then the one the fork's preview used. */
interface ImageFolders {
  /** The scene folder; images go to its `files/`. */
  folder: string;
  fork: string;
}

async function pullImages(deps: MapPullDeps, folders: ImageFolders, fingerprints: readonly string[]): Promise<Upload> {
  const { folder } = folders;
  const upload: Upload = { names: new Map(), images: [] };
  const saved = [`${folder}/${IMAGES_DIR}`, folders.fork];
  for (const fingerprint of fingerprints) {
    const existing = saved.flatMap((dir) => ASSET_MIMES.map((mime) => `${dir}/${fingerprint}.${extensionForMime(mime)}`)).find((path) => fileAt(deps.app, path));
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

type Added = { mapPath: string; sceneId: string; text: string | null };

/** The text Atlas wrote is the base, so "changed here" compares with what Atlas saved; none when it cannot be read back. */
async function writeBaseOf(pulled: PulledItems, record: PulledRecord, added: Added): Promise<void> {
  if (added.text !== null) await pulled.writeBase(record, added.text);
}

/**
 * The newer version as a new scene: `follow` moves the record onto it (Take theirs), else it stays on the first (Keep both).
 * Unasked (the map is not changed here), the receiver is told where it went, since Atlas cannot replace the old scene yet.
 */
async function installUpdate(deps: MapPullDeps, add: () => Promise<Added>, known: PulledRecord, follow: boolean, input: MapPullInput, asked: boolean): Promise<PullOutcome> {
  const added = await add();
  if (!asked) deps.notify?.(`The new version of ${input.item.title} is a new scene, ${added.mapPath}: Atlas VTT cannot replace a scene yet.`);
  if (!follow) return { kind: 'both', path: added.mapPath };
  const record = deps.pulled.update(known.key, { path: added.mapPath, sceneId: added.sceneId, version: input.item.version, pulledAt: (deps.now ?? Date.now)() }) ?? known;
  await writeBaseOf(deps.pulled, record, added);
  return { kind: 'updated', path: added.mapPath };
}

/**
 * Connect's own pulls one at a time: which images are already saved is decided right before Atlas writes the others.
 * The queue is module-wide, so a Keep both / Take theirs dialog left open holds every other map pull until it closes.
 */
let writing: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = writing.then(task);
  writing = run.catch(() => undefined);
  return run;
}

export function pullMap(deps: MapPullDeps, input: MapPullInput): Promise<PullOutcome> {
  return oneAtATime(() => writeMap(deps, input));
}

/** For a map pulled before whose file is still there: unchanged, cancelled, or whether later pulls follow the new scene. */
async function updateChoice(deps: MapPullDeps, known: PulledRecord, file: TFile, input: MapPullInput): Promise<'unchanged' | 'cancelled' | { follow: boolean; asked: boolean }> {
  const base = await deps.pulled.readBase(known);
  const changedHere = base !== null && (await deps.app.vault.read(file)) !== base;
  // The version already pulled, still as Atlas saved it: nothing to add.
  if (base !== null && !changedHere && known.version === input.item.version) return 'unchanged';
  if (!changedHere) return { follow: true, asked: false };
  const choice = await deps.confirmUpdate(input.item.title);
  return choice === null ? 'cancelled' : { follow: choice === 'theirs', asked: true };
}

async function writeMap(deps: MapPullDeps, input: MapPullInput): Promise<PullOutcome> {
  const { app, scenes, pulled } = deps;
  await pulled.ready();
  const known = pulled.get(input.tableId, input.from, input.item.item);
  const knownFile = known ? fileAt(app, known.path) : null;
  const update = known && knownFile ? await updateChoice(deps, known, knownFile, input) : null;
  if (update === 'unchanged') return { kind: 'unchanged', path: known!.path };
  if (update === 'cancelled') return { kind: 'cancelled' };
  const collection = await sharedCollectionId(scenes);
  const person = safeFileName(input.personName, 'Someone');
  const folder = `${COLLECTIONS_DIR}/${collection}/scenes/${person}`;
  const upload = await pullImages(deps, { folder, fork: `${COLLECTIONS_DIR}/${collection}/${IMAGES_DIR}/${person}` }, input.payload.images);
  const map = receivedMapInput(input.payload, { images: upload.names, notes: linkedNotes(deps, input), isFile: (path) => path.length < 1024 && fileAt(app, path) !== null });
  const add = async (): Promise<Added> => {
    // Atlas checks that the folder lies inside the collection's and every image inside the folder, and names the file itself.
    const added = await scenes.addToCollection({ collection: { name: SHARED_COLLECTION }, name: safeFileName(input.payload.name), folder, map, images: upload.images });
    const file = fileAt(app, added.mapPath);
    return { ...added, text: file ? await app.vault.read(file) : null };
  };
  if (known && update) return installUpdate(deps, add, known, update.follow, input, update.asked);
  const added = await add();
  const record = pulled.put({
    tableId: input.tableId, from: input.from, item: input.item.item, kind: 'map', path: added.mapPath, version: input.item.version,
    pulledAt: (deps.now ?? Date.now)(), sceneId: added.sceneId, ...(known ? { baseKey: known.baseKey } : {}),
  });
  await writeBaseOf(pulled, record, added);
  return { kind: 'created', path: added.mapPath };
}
