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
  read(path: string): Promise<ArrayBuffer>;
  /** Tells when a file was modified, deleted or renamed (both paths); returns the unsubscribe. */
  onChange?(listener: (path: string) => void): () => void;
}

/** Where a fingerprint's file is. */
export interface AssetInfo {
  path: string;
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
}

/** What the scene handlers need of the session: register a handler, send to a player, list the players. */
export interface SceneSession {
  use(handler: SessionHandler): () => void;
  send(playerId: string, message: ControlMessage): void;
  getPlayers(): SessionPlayer[];
}
