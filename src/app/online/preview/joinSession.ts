/**
 * Joins the player session to the image loader, for the web player page (no
 * Obsidian imports): the loader gets the assets channel and follows every
 * scene the session presents. Kept apart from the page so it is tested.
 */
import { PlayerSession, type PlayerAssetHandler, type PlayerSessionOptions } from '../PlayerSession';
import type { PlayerScene } from '../scene/sceneTypes';

/** The image loader as the session needs it. */
export interface SceneImageLoader extends PlayerAssetHandler {
  setScene(scene: PlayerScene | null): void;
}

export type JoinSessionOptions = Omit<PlayerSessionOptions, 'assets' | 'onScene'> & {
  loader: SceneImageLoader;
  /** The presented scene changed; the loader has been told already. */
  onScene: (scene: PlayerScene | null) => void;
};

export function createJoinSession(options: JoinSessionOptions): PlayerSession {
  const { loader, onScene, ...session } = options;
  return new PlayerSession({
    ...session,
    assets: loader,
    onScene: (scene) => {
      loader.setScene(scene);
      onScene(scene);
    },
  });
}
