/**
 * Connect's "Controlled by", remembered across sessions, on a stock Atlas.
 *
 * Connect's "Controlled by" gives a placed token to an online player for the running session only (the session's
 * `TokenControl`), so every session would need the same assignments made again. This remembers which player each token was
 * given to, by the player's name, and gives it to them again whenever they are at the table and its scene is one the GM
 * works on: in Atlas's view, presented, or on Tabletop's board (read from the map's file while Atlas's view is not loaded).
 * Taking a token from a player takes the memory with it.
 *
 * Atlas 0.8 marks a library token as a player character (`TokenAsset.playerCharacter`); the tokens placed from it on any
 * scene are that character, so a character is remembered by its library token and given back on every scene. Any other
 * token is remembered as itself: its map and its id (`tokenKey`).
 *
 * It never gives a token to anyone who was not asked for by name: no player at the table of that name, or two of them, and
 * nothing is assigned.
 */
import type { Disposer } from '@atlas-vtt/api-types';

/** A token placed on a scene, as far as telling its library token goes. */
export interface PlacedToken {
  assetId?: string | undefined;
  imagePath?: string | undefined;
}

/** A token of Atlas's library. */
export interface LibraryToken {
  id: string;
  imagePath: string;
  playerCharacter?: boolean | undefined;
}

/** The library token a placed token was placed from: the one its `assetId` names, else the one whose art it shows. */
export function libraryTokenOf(token: PlacedToken, library: readonly LibraryToken[]): LibraryToken | null {
  if (token.assetId !== undefined) {
    const named = library.find((asset) => asset.id === token.assetId);
    if (named) return named;
  }
  return token.imagePath === undefined ? null : library.find((asset) => asset.imagePath === token.imagePath) ?? null;
}

/** The placed tokens that are player characters, by token id, with the library token each is. */
export function playerCharacterTokens(tokens: Readonly<Record<string, PlacedToken | undefined>>, library: readonly LibraryToken[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const [tokenId, token] of Object.entries(tokens)) {
    const asset = token ? libraryTokenOf(token, library) : null;
    if (asset?.playerCharacter === true) found.set(tokenId, asset.id);
  }
  return found;
}

/**
 * Who each token was given to, by the player's name: a player character under its library token's id, any other token under
 * `tokenKey` of its map and id.
 */
export type Remembered = Readonly<Record<string, string>>;

const TOKEN_KEY = 'token:';

/** Where a token that is no player character is remembered: its map's path and its id. */
export function tokenKey(mapPath: string, tokenId: string): string {
  return `${TOKEN_KEY}${mapPath}#${tokenId}`;
}

export interface PartyPlayer {
  playerId: string;
  name: string;
  status: string;
}

export interface PartyControl {
  controls(playerId: string, tokenId: string): boolean;
  set(tokenId: string, playerId: string, controlled: boolean): void;
  onChange(listener: () => void): Disposer;
}

/** The scene the GM works on, as far as telling its tokens goes. */
export interface PartyScene {
  /** Its map's path; null while it is not known (then only player characters are kept). */
  mapPath: string | null;
  tokens: Readonly<Record<string, PlacedToken | undefined>>;
  /**
   * Whether `tokens` are the scene's every token now (a loaded Atlas map view), so a remembered token missing from them
   * was deleted. False for the map's saved file, read while Atlas's view is not loaded (the GM on Tabletop's board).
   */
  live: boolean;
}

export interface PartyLinksDeps {
  /** The session: who is at the table, and who controls which token (null while none is hosted). */
  session: {
    state(): { players: readonly PartyPlayer[]; tokenControl: PartyControl | null };
    subscribe(listener: () => void): Disposer;
  };
  /** The scenes the GM works on (the one in Atlas's view, the presented one, those on Tabletop's boards), one per map. */
  scenes(): readonly PartyScene[];
  /** Calls `listener` when the scene or its tokens may have changed. */
  watchScene(listener: () => void): Disposer;
  /** Atlas's library tokens; null while they cannot be read (no Atlas map view loaded), so the last read stands. */
  library(): Promise<readonly LibraryToken[] | null>;
  memory: { load(): Promise<Remembered>; save(remembered: Remembered): Promise<void> };
}

/** How long Atlas's library is trusted before it is read again, so a token made a player character is noticed. */
const LIBRARY_MS = 10_000;

export class PartyLinks {
  private remembered: Record<string, string> = {};
  private loaded = false;
  private library: readonly LibraryToken[] | null = null;
  private libraryAt = -Infinity;
  private reading = false;
  /** A refresh asked for while the library was read: run once it is. */
  private again = false;
  private queued = false;
  private control: PartyControl | null = null;
  private stopControl: Disposer | null = null;
  /** Who controlled each token at the last look: a player who still has no token they had was taken it from. */
  private readonly lastControllers = new Map<string, ReadonlySet<string>>();
  private readonly stops: Disposer[] = [];
  private stopped = false;

  constructor(private readonly deps: PartyLinksDeps, private readonly now: () => number = () => Date.now()) {}

  start(): void {
    this.stops.push(this.deps.session.subscribe(() => this.refreshSoon()), this.deps.watchScene(() => this.refreshSoon()));
    void this.deps.memory.load().then((remembered) => {
      if (this.stopped) return;
      this.remembered = { ...remembered };
      this.loaded = true;
      this.refreshSoon();
    }, () => {
      this.loaded = true;
    });
  }

  stop(): void {
    this.stopped = true;
    for (const stop of this.stops.splice(0)) stop();
    this.stopControl?.();
    this.stopControl = null;
    this.control = null;
  }

  /** What is remembered now (tests and the settings read it). */
  get links(): Remembered {
    return this.remembered;
  }

  private refreshSoon(): void {
    if (this.queued || this.stopped) return;
    this.queued = true;
    queueMicrotask(() => {
      this.queued = false;
      void this.refresh();
    });
  }

  private async refresh(): Promise<void> {
    if (this.stopped || !this.loaded) return;
    if (this.reading) {
      // A change while the library is read (the GM ticking Controlled by) is looked at once it is, never dropped.
      this.again = true;
      return;
    }
    const { tokenControl } = this.deps.session.state();
    this.follow(tokenControl);
    const scenes = this.deps.scenes().filter((scene) => Object.keys(scene.tokens).length > 0);
    if (!tokenControl || scenes.length === 0) {
      this.lastControllers.clear();
      return;
    }
    if (this.libraryAt === -Infinity || this.now() - this.libraryAt > LIBRARY_MS) {
      this.reading = true;
      try {
        // Not readable now (no Atlas view): the last library read stands, or none is known.
        this.library = (await this.deps.library()) ?? this.library;
      } catch {
        // Atlas's library cannot be read: the last read stands.
      } finally {
        this.libraryAt = this.library === null ? -Infinity : this.now();
        this.reading = false;
      }
      if (this.stopped) return;
      if (this.again) {
        this.again = false;
        this.refreshSoon();
        return;
      }
    }
    const now = this.deps.session.state();
    if (now.tokenControl !== tokenControl) {
      this.refreshSoon();
      return;
    }
    this.look(now.players, tokenControl, this.deps.scenes(), this.library);
  }

  /**
   * The placed tokens that are player characters, by token id, with the library token each is. Without a library read
   * yet, a token placed from a library token remembered as a character is one: only characters are remembered so.
   */
  private characters(tokens: PartyScene['tokens'], library: readonly LibraryToken[] | null): Map<string, string> {
    if (library !== null) return playerCharacterTokens(tokens, library);
    const found = new Map<string, string>();
    for (const [tokenId, token] of Object.entries(tokens)) {
      const assetId = token?.assetId;
      if (assetId !== undefined && !assetId.startsWith(TOKEN_KEY) && assetId in this.remembered) found.set(tokenId, assetId);
    }
    return found;
  }

  /** Follows whoever controls what, so an assignment by the GM is learned and one taken back is forgotten. */
  private follow(control: PartyControl | null): void {
    if (control === this.control) return;
    this.stopControl?.();
    this.control = control;
    this.stopControl = control ? control.onChange(() => this.refreshSoon()) : null;
    this.lastControllers.clear();
  }

  private look(players: readonly PartyPlayer[], control: PartyControl, scenes: readonly PartyScene[], library: readonly LibraryToken[] | null): void {
    const now = new Map<string, ReadonlySet<string>>();
    let changed = false;
    for (const scene of scenes) changed = this.lookAt(players, control, scene, library, now) || changed;
    this.lastControllers.clear();
    for (const [tokenId, ids] of now) this.lastControllers.set(tokenId, ids);
    if (changed) void this.deps.memory.save({ ...this.remembered }).catch(() => undefined);
  }

  /** One scene: learns, forgets and gives back its tokens, noting who controls each in `now`; true when memory changed. */
  private lookAt(players: readonly PartyPlayer[], control: PartyControl, scene: PartyScene, library: readonly LibraryToken[] | null, now: Map<string, ReadonlySet<string>>): boolean {
    const admitted = players.filter((player) => player.status === 'admitted');
    const { tokens, mapPath } = scene;
    const characters = this.characters(tokens, library);
    let changed = false;
    // Only every token of the scene now tells a deleted one: a saved file misses tokens placed since.
    if (mapPath !== null && scene.live) {
      // A token of this map that is remembered but no longer on it was deleted: its memory goes with it.
      const prefix = tokenKey(mapPath, '');
      for (const key of Object.keys(this.remembered)) {
        if (key.startsWith(prefix) && !(key.slice(prefix.length) in tokens)) {
          delete this.remembered[key];
          changed = true;
        }
      }
    }
    for (const tokenId of Object.keys(tokens)) {
      if (!tokens[tokenId]) continue;
      // A player character is remembered by its library token, any other token as itself.
      const key = characters.get(tokenId) ?? (mapPath === null ? null : tokenKey(mapPath, tokenId));
      if (key === null) continue;
      const controllers = admitted.filter((player) => control.controls(player.playerId, tokenId));
      if (controllers.length === 1) {
        // Given to one player: that is whose it is.
        const name = controllers[0]!.name;
        if (this.remembered[key] !== name) {
          this.remembered[key] = name;
          changed = true;
        }
      } else if (controllers.length === 0 && key in this.remembered) {
        // A player who had it, still at the table, no longer does: it was taken from them. One who left has not lost it.
        const prior = this.lastControllers.get(tokenId) ?? new Set<string>();
        if ([...prior].some((playerId) => admitted.some((player) => player.playerId === playerId))) {
          delete this.remembered[key];
          changed = true;
        }
      }
      if (controllers.length === 0) {
        const name = this.remembered[key];
        const owners = name === undefined ? [] : admitted.filter((player) => player.name === name);
        // Asked for by name, and exactly one player at the table has it.
        if (owners.length === 1) {
          control.set(tokenId, owners[0]!.playerId, true);
          now.set(tokenId, new Set([owners[0]!.playerId]));
          continue;
        }
      }
      if (controllers.length > 0) now.set(tokenId, new Set(controllers.map((player) => player.playerId)));
    }
    return changed;
  }
}

/** Where the links are kept: a JSON file in Connect's storage folder of Atlas (`storage.folder`). */
export function fileMemory(file: () => Promise<string>, adapter: { exists(path: string): Promise<boolean>; read(path: string): Promise<string>; write(path: string, data: string): Promise<void> }): PartyLinksDeps['memory'] {
  return {
    load: async () => {
      const path = await file();
      if (!(await adapter.exists(path))) return {};
      const parsed: unknown = JSON.parse(await adapter.read(path));
      const links = typeof parsed === 'object' && parsed !== null ? (parsed as { links?: unknown }).links : null;
      if (typeof links !== 'object' || links === null) return {};
      // Only what is a name against a library token's id or a token's key: anything else in the file is not a link.
      return Object.fromEntries(Object.entries(links).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''));
    },
    save: async (remembered) => {
      await adapter.write(await file(), JSON.stringify({ links: remembered }, null, 2));
    },
  };
}
