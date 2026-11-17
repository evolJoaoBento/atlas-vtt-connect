/** The shapes the scene, asset and control code share with the session side (`AssetRegistry`, `sceneSources`). */
import type { BoardCutscene, BoardWater } from './boardTypes';
import type { AssetMime } from '../assets/assetIds';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';

export interface ImageFileStat {
  size: number;
  mtime: number;
}

/** How the asset registry reaches the vault: Atlas's files in the plugin, a map in tests. */
export interface ImageFiles {
  /** Synchronous; null when there is no such file. */
  stat(path: string): ImageFileStat | null;
  /** The file's bytes; `raw` (an animated map's video) asks for the file itself where `read` would give its still. */
  read(path: string, raw?: boolean): Promise<ArrayBuffer>;
  /**
   * Set when `read` gives a smaller copy of a raster image over the file limit (`imageShrink.ts`) instead of the image:
   * such an image is then sent, as that copy, rather than refused.
   */
  readonly reducesLarge?: boolean;
  /** Tells when a file was modified, deleted or renamed (both paths); returns the unsubscribe. */
  onChange?(listener: (path: string) => void): () => void;
}

/** Where a fingerprint's file is. */
export interface AssetInfo {
  path: string;
  /** The file itself, not what `read` makes of it (a video, not its still). */
  raw?: boolean;
  size: number;
  mime: AssetMime;
}

/** A file to serve: its bytes and type. */
export interface AssetFile {
  bytes: ArrayBuffer;
  mime: AssetMime;
}

/** What the projection needs: a fingerprint for a path, or null. */
export interface AssetIds {
  idFor(path: string | null | undefined): string | null;
  /** The fingerprint of an animated map's video itself (`idFor` gives its still); null for any other file, or while it is hashed. */
  videoIdFor?(path: string | null | undefined): string | null;
}

/**
 * A cutscene as Tabletop publishes it (`api.cutscene`): what goes to players, and, on the GM's side only, the vault map
 * each run-local key stands for. The paths never leave the GM's machine.
 */
export interface GmCutscene {
  cutscene: BoardCutscene;
  maps: Readonly<Record<string, string>>;
  /** The level of its map a key stands for (Atlas levels), for the keys that name one; a key without one is the floor Atlas shows. Never sent to players. */
  levels?: Readonly<Record<string, string>>;
}

/** What the scene handlers need of the session: register a handler, send to a player, list the players. */
export interface SceneSession {
  use(handler: SessionHandler): () => void;
  send(playerId: string, message: ControlMessage): void;
  getPlayers(): SessionPlayer[];
}

/**
 * What the GM gave a map on Tabletop's 3D board (Tabletop's `api.boardLook`): heights in grid squares, materials by id
 * with their texture maps, door props and props by vault path. Paths never leave the GM's machine: only asset ids do.
 */
/** A scene stacked with the map (Tabletop's `boardLook(...).layers`): vault paths, which become asset ids. */
export interface BoardLayerLook {
  elevation: number;
  stands: { x: number; y: number; turn: number };
  image: string;
  /** Where its grid lies; `mapStretch`: how Atlas fitted the level's image to the scene's grid (its stretch's factors times its scale, a turn of a few degrees, an offset), absent for an image that fills the scene's frame. */
  grid: { size: number; offsetX: number; offsetY: number; mapStretch?: { x: number; y: number; rotation?: number; offset?: { x: number; y: number } } };
  walls: ReadonlyArray<{
    id: string; type: 'solid' | 'door' | 'secret-door'; p1: { x: number; y: number }; p2: { x: number; y: number }; closed: boolean;
    direction: 'left' | 'right' | null; blocks: 'sight' | 'light' | 'movement' | null; limited: boolean; chain: string | null;
    height: number | null; material: string | null; doorProp: string | null; flip: { hinge: boolean; side: boolean };
    /** A window's opening (grid squares from the floor), where the GM set it; absent from an older Tabletop. */
    window?: { bottom: number; top: number } | null;
    /** A wall's own width in grid squares, where the GM set one; absent from an older Tabletop. */
    width?: number | null;
  }>;
  lights: ReadonlyArray<{
    id: string; x: number; y: number; height: number | null; bright: number; dim: number; color: string; intensity: number;
    animation: string | null; angle: number | null; rotation: number; darkness: boolean; activeBelowAmbient: number | null;
    /** A surface light's outline (lava, acid). */
    area?: ReadonlyArray<{ x: number; y: number }>;
  }>;
  props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number; solid?: boolean; lift?: number }>;
  materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string>; tuning?: { relief: number; occlusion: number; shine: number; depth: number; displace: number; outward: number } }>;
  fogHeight: number | null;
  wallThickness: number | null;
  /** The layer's painted water; absent from an older Tabletop. */
  water?: BoardWater;
  /** The layer's raised shapes (material folders are ids of `materials`); absent for none, or from an older Tabletop. */
  shapes?: ReadonlyArray<BoardShapeLook>;
}

/** A raised shape as Tabletop hands it: corners in map pixels with heights in grid squares; materials by their vault folder (ids of the look's `materials`). */
export interface BoardShapeLook {
  readonly id: string;
  readonly outline: ReadonlyArray<{ x: number; y: number; h: number }>;
  readonly inner: ReadonlyArray<{ x: number; y: number; h: number }>;
  readonly material?: string;
  readonly sides?: true | string;
}

/** The ground round a map as Tabletop hands it (its Ground panel); the material by its vault folder (an id of the look's `materials`). */
export interface BoardGroundLook {
  readonly mode: 'board' | 'horizon' | 'water' | 'lava' | 'acid';
  readonly material?: string;
  readonly noise: string;
  readonly strength: number;
  readonly fog: number;
  readonly margin: number;
  readonly tile: number;
  readonly water: { kind: string; amount: number; direction: number; tint: string; clarity: number };
  readonly lava?: { kind: string; amount: number; direction: number; tint: string; clarity: number; style?: string };
  readonly acid?: { kind: string; amount: number; direction: number; tint: string; clarity: number };
}

export interface BoardLook {
  wallHeight(id: string): number | null;
  wallMaterial(id: string): string | null;
  doorProp(id: string): string | null;
  /** How the GM turned a door from the way Atlas draws it (Tabletop's Rotate 180° and Mirror); absent from an older Tabletop. */
  doorFlip?(id: string): { hinge: boolean; side: boolean };
  /** A window's opening as the GM set it on Tabletop's board; null for the default, absent from an older Tabletop. */
  windowOf?(id: string): { bottom: number; top: number } | null;
  /** A wall's own width (thickness) in grid squares on Tabletop's board; null for the map's, absent from an older Tabletop. */
  wallWidth?(id: string): number | null;
  lightHeight(id: string): number | null;
  readonly fogHeight: number | null;
  readonly wallThickness: number | null;
  /** The scenes stacked with the map; absent from an older Tabletop, or when the GM does not share them. */
  readonly layers?: ReadonlyArray<BoardLayerLook>;
  /** The map's painted water and its motion; absent for none, or from an older Tabletop. */
  readonly water?: BoardWater;
  /** The raised shapes on the level shown; absent for none, or from an older Tabletop. */
  readonly shapes?: ReadonlyArray<BoardShapeLook>;
  /** The ground round the map; absent from an older Tabletop. */
  readonly ground?: BoardGroundLook;
  /** How the GM draws the scenes stacked above (Upper layers); absent from an older Tabletop. */
  readonly layerLook?: 'solid' | 'faded' | 'transparent';
  /** Where the marker sheets lie on the players' table, placed on this map (`tools/arTable.ts`); absent for none, or from an older Tabletop. */
  readonly arTable?: unknown;
  readonly props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number; solid?: boolean; lift?: number }>;
  readonly materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string>; tuning?: { relief: number; occlusion: number; shine: number; depth: number; displace: number; outward: number } }>;
}
