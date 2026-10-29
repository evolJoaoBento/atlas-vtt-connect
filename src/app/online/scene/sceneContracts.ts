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
export interface BoardLook {
  wallHeight(id: string): number | null;
  wallMaterial(id: string): string | null;
  doorProp(id: string): string | null;
  lightHeight(id: string): number | null;
  readonly fogHeight: number | null;
  readonly wallThickness: number | null;
  readonly ambient: number | null;
  readonly props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number }>;
  readonly materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string> }>;
}
