/**
 * What the player visibility reader hands out, as Atlas's extension API names it (`@atlas-vtt/api-types`, which
 * Tabletop does not have): the same shapes, so Connect passes them on as its API's.
 */
export type Disposer = () => void;

/** How the player window shows a token: seen, outlined only (sensed), or not at all. */
export type Perception = 'seen' | 'sensed' | 'unseen';

export type PlayerVisibility =
  /** Lighting hides nothing: dynamic lighting off, or the scene unlit. */
  | { readonly status: 'unlit' }
  /** Not worked out for the scene the store holds yet: show players nothing. */
  | { readonly status: 'pending' }
  | {
    readonly status: 'ready';
    /** By lighting only: a token the GM hid can read 'seen' here, so apply `hidden` and fog yourself. */
    readonly tokens: Readonly<Record<string, Perception>>;
    /** Where the player window shows the map, cell by cell (1 = shown), from the map's top-left corner, row by row; a fresh copy. */
    readonly darkness: { readonly cellSize: number; readonly cols: number; readonly rows: number; readonly shown: Uint8Array };
    /** The window shows explored memory where no token sees. */
    readonly showsExplored: boolean;
  };

export interface PlayerVisibilityOptions {
  /** The map's long side holds at most this many cells (16–1024, default 384). */
  maxCellsPerSide?: number;
  /** Only this token's sight (a point of view): the map is shown where it sees, and nowhere else. */
  onlyToken?: string;
}

export interface LightingApi {
  /** What the GM's player window shows of the view's lit scene. Never throws: anything not known is `pending`. */
  playerVisibility(viewId: string, options?: PlayerVisibilityOptions): PlayerVisibility;
  /** Called when what `playerVisibility` returns may have changed. */
  watch(viewId: string, listener: () => void): Disposer;
}
