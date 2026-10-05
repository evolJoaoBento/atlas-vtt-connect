import type { Json, SceneRecord, ScenesApi } from '@atlas-vtt/api-types';
import { importScene, type AddInput, type ImportTarget } from './fakeSceneImport';
import { replaceScene, type ReplaceInput, type ReplaceTarget } from './fakeSceneReplace';
import { mapFileText, savedMapInput, type FakeMapState } from './fakeSavedMap';

/**
 * A scene record as Atlas's asset index keeps it: extension data under `data.extensions`, the fork's legacy
 * `data.sharing`, and for a scene an extension added, `createdBy` and `createdImages` (in the index only).
 */
export interface FakeSceneRecord {
  id: string;
  name: string;
  collectionId: string;
  mapPath: string | null;
  data: { extensions?: Record<string, Json>; sharing?: unknown; [key: string]: unknown };
}

/** The vault `addToCollection` writes into: the in-memory app's files (text, as its `createBinary` keeps them) and folders. */
export interface FakeSceneVault {
  files: Map<string, string>;
  folders: Set<string>;
}

const LEGACY_SHARING_EXTENSION_ID = 'atlas-vtt-connect';

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
};

/** `value` as plain JSON, or a clear error, as Atlas's `setData`. */
function plainJson(value: unknown): Json {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new Error(`[Atlas API] setData needs plain JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (text === undefined) throw new Error('[Atlas API] setData needs plain JSON (or null to clear).');
  return JSON.parse(text) as Json;
}

/** A record as the index loads it: the fork's `data.sharing` moves into Connect's extension data once (`legacySceneData.ts`). */
function loadedData(data: FakeSceneRecord['data']): FakeSceneRecord['data'] {
  const { sharing, extensions: previous, ...plain } = structuredClone(data);
  const extensions: Record<string, Json> = { ...(previous ?? {}) };
  if (!(LEGACY_SHARING_EXTENSION_ID in extensions) && sharing !== undefined) extensions[LEGACY_SHARING_EXTENSION_ID] = sharing as Json;
  return Object.keys(extensions).length > 0 ? { ...plain, extensions } : plain;
}

/**
 * Atlas's scene records and saved maps (Appendix A, C-scenes-1..5): extension data per extension id (a legacy
 * `data.sharing` moved into Connect's as the index loads), `readMap` from the map files in the vault (`fakeSavedMap`),
 * `addToCollection` as Atlas's `sceneImport` (`fakeSceneImport`) and `replaceMap` as its `sceneReplace`
 * (`fakeSceneReplace`), under one lock. Every change to a record's name, map or collection, an add and a removal fire
 * 'scenes-changed'.
 */
export class FakeScenes {
  private readonly records = new Map<string, FakeSceneRecord>();
  /** The vault's files, by path: the in-memory app's when one is given, else the fake's own. */
  readonly files: Map<string, string>;
  readonly folders: Set<string>;
  /** Collection id → name. */
  readonly collections = new Map<string, string>();
  /** The natural size of a background image, by its vault path (Atlas reads the image header); 0 x 0 otherwise. */
  private readonly imageSizes = new Map<string, { width: number; height: number }>();
  private lock: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  /** Set by a test: the next `addToCollection` fails after its writes, or (`after: 'record'`) once its record was added. */
  failNextAdd: { error: Error; after: 'writes' | 'record' } | null = null;
  /** Set by a test: runs inside the next `replaceMap` calls, after the images and before the map is written. */
  beforeMapWrite: (() => void) | null = null;

  /** `openMaps`: the map paths open in a map view (loaded, or among its scene tabs), which `replaceMap` refuses. */
  constructor(private readonly changed: () => void, vault?: FakeSceneVault, private readonly openMaps: () => ReadonlySet<string> = () => new Set()) {
    this.files = vault?.files ?? new Map();
    this.folders = vault?.folders ?? new Set();
  }

  /** The GM adds a scene to a collection (or the index loads it). */
  addScene(scene: { id?: string; name: string; collectionId?: string; mapPath: string | null; data?: FakeSceneRecord['data'] }): string {
    const id = scene.id ?? `scene-${this.nextId++}`;
    const collectionId = scene.collectionId ?? 'source';
    if (!this.collections.has(collectionId)) this.collections.set(collectionId, collectionId);
    this.records.set(id, { id, name: scene.name, collectionId, mapPath: scene.mapPath, data: loadedData(scene.data ?? {}) });
    this.changed();
    return id;
  }

  /** The scene's map file moved (a vault rename): Atlas points the record at the new path. */
  moveMap(sceneId: string, mapPath: string): void {
    const record = this.records.get(sceneId);
    if (!record) return;
    record.mapPath = mapPath;
    this.changed();
  }

  /** Something that is no scene change: a tag edit. No 'scenes-changed'. */
  tag(sceneId: string, tags: readonly string[]): void {
    const record = this.records.get(sceneId);
    if (record) record.data = { ...record.data, tags: [...tags] };
  }

  removeScene(sceneId: string): void {
    if (this.records.delete(sceneId)) this.changed();
  }

  /**
   * Writes the map file at `path` with `state`; `saved` is what else the file holds (pins, notes, logs), which
   * `readMap` never hands out; `mapSize` is the natural size of its background image.
   */
  setMap(path: string, state: FakeMapState, options: { mapSize?: { width: number; height: number }; saved?: Record<string, unknown> } = {}): void {
    this.files.set(path, mapFileText(state, options.saved));
    if (options.mapSize && state.background) this.imageSizes.set(state.background, options.mapSize);
  }

  /** The record as the index holds it (a copy). */
  record(sceneId: string): FakeSceneRecord | null {
    const record = this.records.get(sceneId);
    return record ? structuredClone(record) : null;
  }

  /** What a copy, export or install of the scene's record carries (its record file): never extension data, the legacy `data.sharing`, or who added it. */
  exported(sceneId: string): FakeSceneRecord | null {
    const record = this.record(sceneId);
    if (!record) return null;
    const { extensions: _extensions, sharing: _sharing, createdBy: _createdBy, createdImages: _createdImages, ...data } = record.data;
    return { ...record, data };
  }

  api(extensionId: string): ScenesApi {
    const recordOf = (record: FakeSceneRecord): SceneRecord => deepFreeze({ id: record.id, name: record.name, collectionId: record.collectionId, mapPath: record.mapPath });
    return Object.freeze({
      list: async (): Promise<SceneRecord[]> => [...this.records.values()].map(recordOf),
      findByMap: async (mapPath: string): Promise<SceneRecord | null> => {
        const record = [...this.records.values()].find((candidate) => candidate.mapPath === mapPath);
        return record ? recordOf(record) : null;
      },
      getData: async (sceneId: string): Promise<Json | undefined> => {
        const extensions = this.records.get(sceneId)?.data.extensions;
        return extensions && Object.hasOwn(extensions, extensionId) ? deepFreeze(structuredClone(extensions[extensionId]!)) : undefined;
      },
      setData: async (sceneId: string, value: Json | null): Promise<void> => {
        const copy = value === null ? null : plainJson(value);
        // Re-read right before writing and change only this extension's key, as Atlas does (F-b).
        await this.exclusive(async () => {
          const record = this.records.get(sceneId);
          if (!record) throw new Error(`[Atlas API] There is no scene with the id "${String(sceneId)}".`);
          const { extensions: current, ...rest } = record.data;
          const next = Object.fromEntries(Object.entries(current ?? {}).filter(([key]) => key !== extensionId));
          if (copy !== null) next[extensionId] = copy;
          record.data = Object.keys(next).length > 0 ? { ...rest, extensions: next } : rest;
        });
      },
      readMap: async (mapPath: string) => {
        if (typeof mapPath !== 'string' || !mapPath.endsWith('.atlasmap')) throw new Error('[Atlas API] readMap needs the path of an .atlasmap file.');
        const text = this.files.get(mapPath);
        if (text === undefined) return null;
        // The fields of `SavedMap`: the GM's note, the dice log, explored memory and the rest stay behind.
        const map = savedMapInput(text);
        return deepFreeze({ ...map, mapSize: (map.background ? this.imageSizes.get(map.background) : undefined) ?? { width: 0, height: 0 } });
      },
      addToCollection: (input: AddInput) => this.exclusive(async () => importScene(this.importTarget(), input, extensionId)),
      replaceMap: (sceneId: string, input: ReplaceInput) => this.exclusive(async () => replaceScene(this.replaceTarget(), extensionId, sceneId, input)),
    });
  }

  /** One call at a time, as Atlas's asset index lock. */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.lock.then(run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  private importTarget(): ImportTarget {
    return {
      files: this.files,
      folders: this.folders,
      collections: this.collections,
      scenes: () => new Map([...this.records].map(([id, record]) => [id, record.mapPath])),
      addRecord: (name, collectionId, mapPath, created) => {
        const id = `scene-${this.nextId++}`;
        this.records.set(id, { id, name, collectionId, mapPath, data: { ...created } });
        this.changed();
        return id;
      },
      removeRecord: (sceneId) => this.removeScene(sceneId),
      takeFailure: () => {
        const failure = this.failNextAdd;
        this.failNextAdd = null;
        return failure;
      },
    };
  }

  private replaceTarget(): ReplaceTarget {
    return {
      files: this.files,
      record: (sceneId) => this.records.get(sceneId),
      records: () => [...this.records.values()],
      openMaps: this.openMaps,
      beforeMapWrite: this.beforeMapWrite,
    };
  }
}
