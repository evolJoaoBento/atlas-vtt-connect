/** The shapes the scene, asset and control code share with the session side (`AssetRegistry`, `sceneSources`). */
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
  grid: { size: number; offsetX: number; offsetY: number };
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
  }>;
  props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number; solid?: boolean; lift?: number }>;
  materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string>; tuning?: { relief: number; occlusion: number; shine: number; depth: number; displace: number; outward: number } }>;
  fogHeight: number | null;
  wallThickness: number | null;
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
  readonly ambient: number | null;
  /** The colour the GM tinted the board's daylight; absent from an older Tabletop. */
  readonly tint?: string | null;
  /** The scenes stacked with the map; absent from an older Tabletop, or when the GM does not share them. */
  readonly layers?: ReadonlyArray<BoardLayerLook>;
  readonly props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number; solid?: boolean; lift?: number }>;
  readonly materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string>; tuning?: { relief: number; occlusion: number; shine: number; depth: number; displace: number; outward: number } }>;
}
