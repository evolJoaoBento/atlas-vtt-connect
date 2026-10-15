/**
 * Atlas 0.8's player characters and Connect's online players, on a stock Atlas.
 *
 * Atlas marks a library token as a player character (`TokenAsset.playerCharacter`); the tokens placed from it on any scene
 * are that character. Connect's "Controlled by" gives a placed token to an online player for the running session only (the
 * session's `TokenControl`), so every scene and every session would need the same assignments made again. This remembers
 * which player a character was given to, by the player's name, and gives each placed token of that character to them again
 * whenever they are at the table and have it in front of them. Taking a character from a player takes the memory with it.
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

/** Who each player character was given to: the library token's id, then the player's name. */
export type Remembered = Readonly<Record<string, string>>;

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

export interface PartyLinksDeps {
  /** The session: who is at the table, and who controls which token (null while none is hosted). */
  session: {
    state(): { players: readonly PartyPlayer[]; tokenControl: PartyControl | null };
    subscribe(listener: () => void): Disposer;
  };
  /** The tokens of the scene the GM is on, or null while there is none. */
  tokens(): Readonly<Record<string, PlacedToken | undefined>> | null;
  /** Calls `listener` when the scene or its tokens may have changed. */
  watchScene(listener: () => void): Disposer;
  /** Atlas's library tokens. */
  library(): Promise<readonly LibraryToken[]>;
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
  private queued = false;
  private control: PartyControl | null = null;
  private stopControl: Disposer | null = null;
  /** Who controlled each player character's token at the last look: a player who still has no token they had was taken it from. */
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
    if (this.stopped || !this.loaded || this.reading) return;
    const { players, tokenControl } = this.deps.session.state();
    this.follow(tokenControl);
    const tokens = this.deps.tokens();
    if (!tokenControl || !tokens || Object.keys(tokens).length === 0) {
      this.lastControllers.clear();
      return;
    }
    if (this.library === null || this.now() - this.libraryAt > LIBRARY_MS) {
      this.reading = true;
      try {
        this.library = await this.deps.library();
        this.libraryAt = this.now();
      } catch {
        // Atlas's library cannot be read: no token is known as a player character.
        this.library = [];
        this.libraryAt = this.now();
      } finally {
        this.reading = false;
      }
      if (this.stopped) return;
    }
    this.look(players, tokenControl, this.deps.tokens() ?? tokens, this.library);
  }

  /** Follows whoever controls what, so an assignment by the GM is learned and one taken back is forgotten. */
  private follow(control: PartyControl | null): void {
    if (control === this.control) return;
    this.stopControl?.();
    this.control = control;
    this.stopControl = control ? control.onChange(() => this.refreshSoon()) : null;
    this.lastControllers.clear();
  }

  private look(players: readonly PartyPlayer[], control: PartyControl, tokens: Readonly<Record<string, PlacedToken | undefined>>, library: readonly LibraryToken[]): void {
    const admitted = players.filter((player) => player.status === 'admitted');
    const characters = playerCharacterTokens(tokens, library);
    const now = new Map<string, ReadonlySet<string>>();
    let changed = false;
    for (const [tokenId, assetId] of characters) {
      const controllers = admitted.filter((player) => control.controls(player.playerId, tokenId));
      if (controllers.length === 1) {
        // Given to one player: that is who this character is.
        const name = controllers[0]!.name;
        if (this.remembered[assetId] !== name) {
          this.remembered[assetId] = name;
          changed = true;
        }
      } else if (controllers.length === 0 && assetId in this.remembered) {
        // A player who had it, still at the table, no longer does: it was taken from them. One who left has not lost it.
        const prior = this.lastControllers.get(tokenId) ?? new Set<string>();
        if ([...prior].some((playerId) => admitted.some((player) => player.playerId === playerId))) {
          delete this.remembered[assetId];
          changed = true;
        }
      }
      if (controllers.length === 0) {
        const name = this.remembered[assetId];
        const owners = name === undefined ? [] : admitted.filter((player) => player.name === name);
        // Asked for by name, and exactly one player at the table has it.
        if (owners.length === 1) {
          control.set(tokenId, owners[0]!.playerId, true);
          now.set(tokenId, new Set([owners[0]!.playerId]));
          continue;
        }
      }
      now.set(tokenId, new Set(controllers.map((player) => player.playerId)));
    }
    this.lastControllers.clear();
    for (const [tokenId, ids] of now) this.lastControllers.set(tokenId, ids);
    if (changed) void this.deps.memory.save({ ...this.remembered }).catch(() => undefined);
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
      // Only what is a name against a library token's id: anything else in the file is not a link.
      return Object.fromEntries(Object.entries(links).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''));
    },
    save: async (remembered) => {
      await adapter.write(await file(), JSON.stringify({ links: remembered }, null, 2));
    },
  };
}
