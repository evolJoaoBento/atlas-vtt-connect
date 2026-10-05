import type { Json, SavedMapInput, SceneRecord, ScenesApi } from '@atlas-vtt/api-types';

/** A scene record as Atlas's asset index keeps it: extension data under `data.extensions`, and the fork's legacy `data.sharing`. */
export interface FakeSceneRecord {
  id: string;
  name: string;
  collectionId: string;
  mapPath: string | null;
  data: { extensions?: Record<string, Json>; sharing?: unknown; [key: string]: unknown };
}

/** A saved map as a test gives it: what `readMap` returns, plus anything private a real file also holds (pins, notes). */
export type FakeSavedMap = SavedMapInput & { mapSize?: { width: number; height: number } } & Record<string, unknown>;

type AddInput = Parameters<ScenesApi['addToCollection']>[0];

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
};

/** Whether `path` is a plain relative path: no empty, `.` or `..` segment, no leading slash or backslash (as Atlas checks). */
const isPlainRelative = (path: unknown): path is string => typeof path === 'string' && path.length > 0 && !path.includes('\\') && !path.startsWith('/')
  && path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');

const COLLECTIONS = 'atlas-vtt/collections';

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

/**
 * Atlas's scene records and saved maps (Appendix A, C-scenes-1..4): extension data per extension id, `readMap` from
 * the maps a test sets, and `addToCollection` writing into the fake's vault (`files`) under one lock, leaving nothing
 * behind when it fails. Every change to a record's name, map or collection, an add and a removal fire 'scenes-changed'.
 */
export class FakeScenes {
  private readonly records = new Map<string, FakeSceneRecord>();
  private readonly maps = new Map<string, FakeSavedMap>();
  /** The fake's vault: what `addToCollection` wrote, by path. */
  readonly files = new Map<string, ArrayBuffer | string>();
  readonly collections = new Set<string>();
  private lock: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  /** Set by a test: the next `addToCollection` fails after its writes, as a full index would. */
  failNextAdd: Error | null = null;

  constructor(private readonly changed: () => void) {}

  /** The GM adds a scene to a collection. */
  addScene(scene: { id?: string; name: string; collectionId?: string; mapPath: string | null; data?: FakeSceneRecord['data'] }): string {
    const id = scene.id ?? `scene-${this.nextId++}`;
    const collectionId = scene.collectionId ?? 'source';
    this.collections.add(collectionId);
    this.records.set(id, { id, name: scene.name, collectionId, mapPath: scene.mapPath, data: structuredClone(scene.data ?? {}) });
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

  /** The saved map at `path`, as its file holds it. */
  setMap(path: string, map: FakeSavedMap): void {
    this.maps.set(path, structuredClone(map));
  }

  /** The record as the index holds it (a copy). */
  record(sceneId: string): FakeSceneRecord | null {
    const record = this.records.get(sceneId);
    return record ? structuredClone(record) : null;
  }

  /** What a copy, export or install of the scene's record carries: never extension data or the legacy `data.sharing`. */
  exported(sceneId: string): FakeSceneRecord | null {
    const record = this.record(sceneId);
    if (!record) return null;
    const { extensions: _extensions, sharing: _sharing, ...data } = record.data;
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
        const map = this.maps.get(mapPath);
        if (!map) return null;
        // Only the fields of `SavedMapInput`: pins, walls, lights, notes and logs stay behind.
        const { tokens, texts, drawings, fog } = map.objects;
        return deepFreeze(structuredClone({
          background: map.background, grid: map.grid, objects: { tokens, texts, drawings, fog }, widgets: map.widgets, initiative: map.initiative,
          ...(map.lighting ? { lighting: map.lighting } : {}), mapSize: map.mapSize ?? { width: 0, height: 0 },
        }));
      },
      addToCollection: (input: AddInput) => this.exclusive(() => this.add(input)),
    });
  }

  /** One call at a time, as Atlas's asset index lock. */
  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.lock.then(run);
    this.lock = result.catch(() => undefined);
    return result;
  }

  private async add(input: AddInput): Promise<{ sceneId: string; mapPath: string }> {
    const collectionId = 'id' in input.collection ? input.collection.id : input.collection.name.trim();
    if ('id' in input.collection && !this.collections.has(collectionId)) throw new Error(`[Atlas API] There is no collection with the id "${collectionId}".`);
    if (collectionId.includes('/')) throw new Error('[Atlas API] The collection name cannot be used: it cannot contain "/".');
    if (!isPlainRelative(input.folder) || !input.folder.startsWith(`${COLLECTIONS}/${collectionId}/`)) {
      throw new Error(`[Atlas API] The folder must lie inside the collection's folder, ${COLLECTIONS}/${collectionId}.`);
    }
    for (const image of input.images) {
      if (!isPlainRelative(image.path)) throw new Error(`[Atlas API] The image path "${image.path}" must stay inside the folder.`);
    }
    const created = !this.collections.has(collectionId);
    const written: string[] = [];
    try {
      for (const image of input.images) {
        const target = `${input.folder}/${image.path}`;
        if (this.files.has(target)) throw new Error(`[Atlas API] There is already a file at ${target}.`);
        this.files.set(target, image.data);
        written.push(target);
      }
      const taken = new Set([...this.files.keys(), ...[...this.records.values()].flatMap((record) => (record.mapPath ? [record.mapPath] : []))].map((path) => path.toLowerCase()));
      let mapPath = `${input.folder}/${input.name}.atlasmap`;
      for (let n = 2; taken.has(mapPath.toLowerCase()); n++) mapPath = `${input.folder}/${input.name} (${n}).atlasmap`;
      this.files.set(mapPath, JSON.stringify({ state: { ...input.map, mapPath } }));
      written.push(mapPath);
      if (this.failNextAdd) {
        const error = this.failNextAdd;
        this.failNextAdd = null;
        throw error;
      }
      this.collections.add(collectionId);
      const sceneId = `scene-${this.nextId++}`;
      this.records.set(sceneId, { id: sceneId, name: input.name, collectionId, mapPath, data: {} });
      this.changed();
      return { sceneId, mapPath };
    } catch (error) {
      for (const path of written) this.files.delete(path);
      if (created) this.collections.delete(collectionId);
      throw error;
    }
  }
}
