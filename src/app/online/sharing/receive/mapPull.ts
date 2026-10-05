/**
 * Adds a pulled map to the `Shared with me` collection with one `scenes.addToCollection`: Atlas writes its images,
 * the map file and the scene record under its asset index lock, and on failure leaves nothing behind. Each image is
 * checked against its fingerprint by the transfer and again here, since the fingerprint names its file; one saved
 * by an earlier pull from the same person is used again by its vault path, also where the fork's online play preview
 * saved it (`<collection>/files/<person>/`), so a map received there is not downloaded again. A re-pull of a map changed here asks
 * Keep both or Take theirs.
 *
 * With Atlas's `scenes.replaceMap` (1.13.0), a re-pull replaces the received map in place, as the fork did: unchanged
 * here, or with Take theirs; Keep both adds the new version as a second scene that later pulls do not follow. A scene
 * open in a map view is not replaced: the receiver is told to close it, and the pull stays pending. Only a scene Connect
 * added on such an Atlas is replaced (`PulledRecord.replaceable`): one the fork's preview made, or one added before,
 * gets the new version as a new scene, as on an older Atlas, where the newer version always arrives as a new scene
 * (`installUpdate`): with Take theirs later pulls follow the new one, with Keep both they keep following the first.
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
  scenes: Pick<ScenesApi, 'addToCollection' | 'list' | 'replaceMap'>;
  /** Whether the map file is open in a GM map view (loaded or among its scene tabs), where Atlas will not replace it. */
  isOpen?(mapPath: string): boolean;
  pulled: PulledItems;
  /** Pulls one image of the map by fingerprint (checked by the transfer). */
  pullImage(fingerprint: string): Promise<PulledItem>;
  /** The map's linked notes the receiver ticked in this pull: item id → vault path. */
  notes: ReadonlyMap<string, string>;
  /** The received map changed here since the last pull; `replaces`: Take theirs replaces the receiver's copy (`replaceMap`). */
  confirmUpdate(title: string, replaces: boolean): Promise<'both' | 'theirs' | null>;
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
  /** The folder of the map file; images go to its `files/`. */
  folder: string;
  fork: string;
}

/** Images pulled in this pull by fingerprint, so a second upload (to another folder) does not pull them again. */
type PulledImages = Map<string, PulledItem | null>;

async function pullImages(deps: MapPullDeps, folders: ImageFolders, fingerprints: readonly string[], fetched: PulledImages = new Map()): Promise<Upload> {
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
    if (!fetched.has(fingerprint)) fetched.set(fingerprint, await deps.pullImage(fingerprint).catch(() => null));
    const image = fetched.get(fingerprint);
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
/** A received map ready for Atlas: the map and the images it names, for one folder. */
type Prepared = { upload: Upload; map: ReturnType<typeof receivedMapInput> };

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));

/** The text Atlas wrote is the base, so "changed here" compares with what Atlas saved; none when it cannot be read back. */
async function writeBaseOf(pulled: PulledItems, record: PulledRecord, added: Added): Promise<void> {
  if (added.text !== null) await pulled.writeBase(record, added.text);
}

/** Why a newer version went to a new scene, told when the receiver was not asked or was told Take theirs replaces. */
const CANNOT_REPLACE = 'Atlas VTT cannot replace a scene yet.';
const OLD_COPY = 'your copy came in before Atlas VTT could replace a received map.';
const REFUSED = 'Atlas VTT did not replace your copy.';

/** The record of a scene Connect added where Atlas can replace it: `replaceMap` is there and Connect added it there. */
function replaceable(deps: MapPullDeps, known: PulledRecord): (PulledRecord & { sceneId: string }) | null {
  return typeof deps.scenes.replaceMap === 'function' && known.replaceable === true && known.sceneId !== undefined ? { ...known, sceneId: known.sceneId } : null;
}

/** Marks a scene Connect adds now as one Atlas lets it replace (it has `replaceMap`, so it notes Connect as the scene's maker). */
const addedHere = (deps: MapPullDeps): { replaceable?: true } => (typeof deps.scenes.replaceMap === 'function' ? { replaceable: true } : {});
/** Told when the received map is open: the pull stays pending until it is closed. */
export const CLOSE_TO_UPDATE = 'Close the scene to update it.';

/**
 * The newer version as a new scene: `follow` moves the record onto it (Take theirs), else it stays on the first (Keep both).
 * `why` is told with where it went (null: say nothing, the receiver chose it).
 */
async function installUpdate(deps: MapPullDeps, add: () => Promise<Added>, known: PulledRecord, follow: boolean, input: MapPullInput, why: string | null): Promise<PullOutcome> {
  const added = await add();
  if (why) deps.notify?.(`The new version of ${input.item.title} is a new scene, ${added.mapPath}: ${why}`);
  if (!follow) return { kind: 'both', path: added.mapPath };
  const record = deps.pulled.update(known.key, { path: added.mapPath, sceneId: added.sceneId, version: input.item.version, pulledAt: (deps.now ?? Date.now)(), ...addedHere(deps) }) ?? known;
  await writeBaseOf(deps.pulled, record, added);
  return { kind: 'updated', path: added.mapPath };
}

const isOpenRefusal = (error: unknown): boolean => error instanceof Error && /open in a map view/.test(error.message);

/**
 * Replaces the received map in place (`replaceMap`), keeping its scene: the record keeps its path and takes the new
 * version, and the text Atlas wrote is its base. An open scene is not touched: the receiver is told to close it and the
 * pull stays pending (cancelled). Null when Atlas refuses for another reason (its index lost who added the scene):
 * the caller adds a new scene instead.
 */
async function replaceKnown(deps: MapPullDeps, known: PulledRecord & { sceneId: string }, input: MapPullInput, prepared: Prepared): Promise<PullOutcome | null> {
  const closeFirst = (): PullOutcome => {
    deps.notify?.(`${input.item.title} is open in a map view. ${CLOSE_TO_UPDATE}`);
    return { kind: 'cancelled' };
  };
  if (deps.isOpen?.(known.path)) return closeFirst();
  try {
    await deps.scenes.replaceMap!(known.sceneId, { map: prepared.map, images: prepared.upload.images });
  } catch (error) {
    if (isOpenRefusal(error)) return closeFirst();
    console.error('[Atlas Connect] Atlas did not replace a received map; it arrives as a new scene:', error);
    return null;
  }
  const record = deps.pulled.update(known.key, { version: input.item.version, pulledAt: (deps.now ?? Date.now)() }) ?? known;
  const file = fileAt(deps.app, known.path);
  if (file) await deps.pulled.writeBase(record, await deps.app.vault.read(file));
  return { kind: 'updated', path: known.path };
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
  const choice = await deps.confirmUpdate(input.item.title, replaceable(deps, known) !== null);
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
  const fetched: PulledImages = new Map();
  // The map and its images for the folder its map file goes in: images are named relative to it.
  const prepare = async (inFolder: string): Promise<Prepared> => {
    const upload = await pullImages(deps, { folder: inFolder, fork: `${COLLECTIONS_DIR}/${collection}/${IMAGES_DIR}/${person}` }, input.payload.images, fetched);
    return { upload, map: receivedMapInput(input.payload, { images: upload.names, notes: linkedNotes(deps, input), isFile: (path) => path.length < 1024 && fileAt(app, path) !== null }) };
  };
  const add = async (): Promise<Added> => {
    const { upload, map } = await prepare(folder);
    // Atlas checks that the folder lies inside the collection's and every image inside the folder, and names the file itself.
    const added = await scenes.addToCollection({ collection: { name: SHARED_COLLECTION }, name: safeFileName(input.payload.name), folder, map, images: upload.images });
    const file = fileAt(app, added.mapPath);
    return { ...added, text: file ? await app.vault.read(file) : null };
  };
  if (known && update) {
    const own = replaceable(deps, known);
    if (own && update.follow) {
      const replaced = await replaceKnown(deps, own, input, await prepare(parentOf(known.path)));
      if (replaced) return replaced;
      return installUpdate(deps, add, known, true, input, REFUSED);
    }
    const why = typeof scenes.replaceMap === 'function' ? OLD_COPY : CANNOT_REPLACE;
    return installUpdate(deps, add, known, update.follow, input, update.asked ? null : why);
  }
  const added = await add();
  const record = pulled.put({
    tableId: input.tableId, from: input.from, item: input.item.item, kind: 'map', path: added.mapPath, version: input.item.version,
    pulledAt: (deps.now ?? Date.now)(), sceneId: added.sceneId, ...(known ? { baseKey: known.baseKey } : {}), ...addedHere(deps),
  });
  await writeBaseOf(pulled, record, added);
  return { kind: 'created', path: added.mapPath };
}
