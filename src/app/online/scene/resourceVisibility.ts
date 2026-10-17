/**
 * What the GM lets players see of each resource on a token, beyond the collection's own switch: per placed token, and
 * per statblock (every token of that creature). A placed token's choice comes first, then its statblock's, then the
 * collection's default: the resource shown with its numbers where the collection shows it to players, else hidden.
 *
 * - `both`: the bar or wheel with its numbers, as Atlas's player window shows a resource it shows.
 * - `bar`: the bar or wheel without numbers; the numbers never leave the GM's machine.
 * - `numbers`: the numbers alone, without the bar or wheel.
 * - `hidden`: nothing of the resource leaves the GM's machine.
 *
 * Kept by the GM in a file of Connect's storage folder of Atlas, never sent: players only receive what it lets through.
 */
import type { ResourceDefinition } from '@atlas-vtt/api-types';

export const RESOURCE_SHOWS = ['both', 'bar', 'numbers', 'hidden'] as const;
export type ResourceShow = typeof RESOURCE_SHOWS[number];

/** Choices by resource key. */
export type ResourceShows = Readonly<Record<string, ResourceShow>>;

export interface ResourceVisibilityData {
  /** By map path, then placed token id. */
  tokens: Readonly<Record<string, Readonly<Record<string, ResourceShows>>>>;
  /** By statblock (`statblockKey`): every token of that creature. */
  statblocks: Readonly<Record<string, ResourceShows>>;
}

export const NO_RESOURCE_VISIBILITY: ResourceVisibilityData = Object.freeze({ tokens: Object.freeze({}), statblocks: Object.freeze({}) });

/** A token as far as its choices go: its statblock, when it has one. */
export interface TokenShowsKey {
  statblockPath?: string | null | undefined;
  statblockName?: string | null | undefined;
}

/** How each resource of a token on one map is shown: the token's id and record give its resolver. */
export type TokenResourceShows = (tokenId: string, token: TokenShowsKey) => (definition: ResourceDefinition) => ResourceShow;

/** The collection's own choice: Atlas's player window shows a resource the collection shows to players, with its numbers. */
export function collectionShow(definition: ResourceDefinition): ResourceShow {
  return definition.visibleToPlayers ? 'both' : 'hidden';
}

/**
 * The key a token's statblock choices are kept under: its statblock note's path, else the bestiary creature's name
 * (`name:Goblin`), as Connect reads a token's sheet; null for a token without a statblock.
 */
export function statblockKey(token: TokenShowsKey): string | null {
  if (typeof token.statblockPath === 'string' && token.statblockPath !== '') return token.statblockPath;
  const name = typeof token.statblockName === 'string' ? token.statblockName.trim() : '';
  return name ? `name:${name}` : null;
}

/** The statblock's name for the GM to read: the creature's name, else the note's name. */
export function statblockLabel(token: TokenShowsKey): string | null {
  const name = typeof token.statblockName === 'string' ? token.statblockName.trim() : '';
  if (name) return name;
  if (typeof token.statblockPath !== 'string' || token.statblockPath === '') return null;
  return (token.statblockPath.split('/').pop() ?? '').replace(/\.md$/i, '') || null;
}

/** The resolver for tokens on the map at `mapPath`: the placed token's choice, else its statblock's, else the collection's. */
export function resourceShowsFor(data: ResourceVisibilityData, mapPath: string | null): TokenResourceShows {
  const placed = mapPath !== null && Object.hasOwn(data.tokens, mapPath) ? data.tokens[mapPath]! : {};
  return (tokenId, token) => {
    const own = Object.hasOwn(placed, tokenId) ? placed[tokenId]! : {};
    const statblock = statblockKey(token);
    const shared = statblock !== null && Object.hasOwn(data.statblocks, statblock) ? data.statblocks[statblock]! : {};
    return (definition) => {
      const key = definition.key;
      if (Object.hasOwn(own, key)) return own[key]!;
      if (Object.hasOwn(shared, key)) return shared[key]!;
      return collectionShow(definition);
    };
  };
}

/** Every token on every map shows what its collection shows: no choice made. */
export const COLLECTION_SHOWS: TokenResourceShows = () => collectionShow;

const isShow = (value: unknown): value is ResourceShow => (RESOURCE_SHOWS as readonly unknown[]).includes(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readShows(value: unknown): ResourceShows | null {
  if (!isRecord(value)) return null;
  const shows = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, ResourceShow] => entry[0] !== '' && isShow(entry[1])));
  return Object.keys(shows).length > 0 ? shows : null;
}

function readByKey<T>(value: unknown, read: (item: unknown) => T | null): Record<string, T> {
  if (!isRecord(value)) return {};
  const result: Record<string, T> = {};
  for (const [key, item] of Object.entries(value)) {
    const got = key === '' ? null : read(item);
    if (got !== null) result[key] = got;
  }
  return result;
}

/** The choices in a file's contents; anything that is not a choice is left out. */
export function readResourceVisibility(value: unknown): ResourceVisibilityData {
  if (!isRecord(value)) return NO_RESOURCE_VISIBILITY;
  const tokens = readByKey(value.tokens, (map) => {
    const placed = readByKey(map, readShows);
    return Object.keys(placed).length > 0 ? placed : null;
  });
  return { tokens, statblocks: readByKey(value.statblocks, readShows) };
}

/** `shows` with `key` set to `show`, or left to the level below (`null`); null when nothing is left. */
function withShow(shows: ResourceShows | undefined, key: string, show: ResourceShow | null): ResourceShows | null {
  const next: Record<string, ResourceShow> = { ...shows };
  if (show === null) delete next[key];
  else next[key] = show;
  return Object.keys(next).length > 0 ? next : null;
}

/** `data` with a placed token's choice for `key` set, or cleared (`null`: its statblock's or the collection's applies). */
export function withTokenShow(data: ResourceVisibilityData, mapPath: string, tokenId: string, key: string, show: ResourceShow | null): ResourceVisibilityData {
  const map: Record<string, ResourceShows> = { ...data.tokens[mapPath] };
  const shows = withShow(map[tokenId], key, show);
  if (shows) map[tokenId] = shows;
  else delete map[tokenId];
  const tokens: Record<string, Readonly<Record<string, ResourceShows>>> = { ...data.tokens };
  if (Object.keys(map).length > 0) tokens[mapPath] = map;
  else delete tokens[mapPath];
  return { tokens, statblocks: data.statblocks };
}

/** `data` with a statblock's choice for `key` set, or cleared (`null`: the collection's applies). */
export function withStatblockShow(data: ResourceVisibilityData, statblockPath: string, key: string, show: ResourceShow | null): ResourceVisibilityData {
  const statblocks: Record<string, ResourceShows> = { ...data.statblocks };
  const shows = withShow(statblocks[statblockPath], key, show);
  if (shows) statblocks[statblockPath] = shows;
  else delete statblocks[statblockPath];
  return { tokens: data.tokens, statblocks };
}

/** Where the choices are kept: Connect's file in its storage folder of Atlas. */
export interface ResourceVisibilityFile {
  load(): Promise<unknown>;
  save(data: ResourceVisibilityData): Promise<void>;
}

/** What the scene projection reads: the choices for a map, and a call when any changes. */
export interface ResourceVisibilitySource {
  forMap(mapPath: string | null): TokenResourceShows;
  subscribe(listener: () => void): () => void;
}

/**
 * The GM's choices, read once from their file and written back after each change. Changes before the file is read
 * apply on top of what it holds.
 */
export class ResourceVisibilityStore implements ResourceVisibilitySource {
  private data: ResourceVisibilityData = NO_RESOURCE_VISIBILITY;
  private readonly listeners = new Set<() => void>();
  private readonly pending: Array<(data: ResourceVisibilityData) => ResourceVisibilityData> = [];
  private loaded = false;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly file: ResourceVisibilityFile) {}

  /** Reads the file; a file that cannot be read leaves no choice made. */
  async load(): Promise<void> {
    let stored: ResourceVisibilityData = NO_RESOURCE_VISIBILITY;
    try {
      stored = readResourceVisibility(await this.file.load());
    } catch (error) {
      console.error('[Atlas VTT Connect] Could not read what players see of resources:', error);
    }
    this.loaded = true;
    this.data = this.pending.splice(0).reduce((data, change) => change(data), stored);
    if (this.data !== stored) this.save();
    this.emit();
  }

  current(): ResourceVisibilityData {
    return this.data;
  }

  forMap(mapPath: string | null): TokenResourceShows {
    return resourceShowsFor(this.data, mapPath);
  }

  /** A placed token's own choice for `key`, or null where it follows its statblock or the collection. */
  tokenShow(mapPath: string, tokenId: string, key: string): ResourceShow | null {
    return this.data.tokens[mapPath]?.[tokenId]?.[key] ?? null;
  }

  /** A statblock's (`statblockKey`) choice for `key`, or null where it follows the collection. */
  statblockShow(statblockPath: string, key: string): ResourceShow | null {
    return this.data.statblocks[statblockPath]?.[key] ?? null;
  }

  setTokenShow(mapPath: string, tokenId: string, key: string, show: ResourceShow | null): void {
    this.change((data) => withTokenShow(data, mapPath, tokenId, key, show));
  }

  setStatblockShow(statblockPath: string, key: string, show: ResourceShow | null): void {
    this.change((data) => withStatblockShow(data, statblockPath, key, show));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Waits for the writes started so far. */
  flush(): Promise<void> {
    return this.saving;
  }

  private change(apply: (data: ResourceVisibilityData) => ResourceVisibilityData): void {
    if (!this.loaded) this.pending.push(apply);
    this.data = apply(this.data);
    if (this.loaded) this.save();
    this.emit();
  }

  private save(): void {
    const data = this.data;
    this.saving = this.saving.then(() => this.file.save(data)).catch((error: unknown) => {
      console.error('[Atlas VTT Connect] Could not save what players see of resources:', error);
    });
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** The file `path`, through a vault adapter. */
export function resourceVisibilityFile(path: () => Promise<string>, adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; write(path: string, data: string): Promise<void> }): ResourceVisibilityFile {
  return {
    load: async () => {
      const file = await path();
      return (await adapter.exists(file)) ? JSON.parse(await adapter.read(file)) as unknown : null;
    },
    save: async (data) => {
      await adapter.write(await path(), JSON.stringify(data, null, 2));
    },
  };
}
