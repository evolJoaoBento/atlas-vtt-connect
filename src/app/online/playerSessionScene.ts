/**
 * The scene and camera half of a player's session: the mirror of the GM's scene for this
 * player (snapshots, patches, resyncs), the GM's latest camera, and whether that scene is
 * paused (`scene-state`: the GM is on another scene). Shared with the web player page, so
 * it imports nothing from Obsidian.
 */
import { decodeControl, type ControlMessage } from './protocol';
import { drawableGridFilter } from './scene/drawableGrid';
import { PlayerSceneMirror } from './scene/PlayerSceneMirror';
import { cameraOfMessage, type SceneCamera } from './scene/sceneCamera';
import type { PlayerScene } from './scene/sceneTypes';

export interface PlayerSceneInboxOptions {
  /** Asks the GM for a fresh snapshot after `seq`. */
  sendResync(seq: number): void;
  /** The presented scene changed: a snapshot or patch applied, or null when the GM shows none. */
  onScene(scene: PlayerScene | null): void;
  /** The GM's latest camera, whatever its scene. */
  onCamera(camera: SceneCamera): void;
  /** The shown scene was paused or is live again; a new scene, or none, is never paused. */
  onPaused?(paused: boolean): void;
  /** Where a dropped grid is told, once per session; `console.warn` by default. */
  warn?(message: string, grid: unknown): void;
}

export const UNDRAWABLE_GRID_WARNING = '[Atlas VTT Connect] The GM sent a grid that cannot be drawn safely; it is shown without a grid.';

export class PlayerSceneInbox {
  private readonly mirror: PlayerSceneMirror;
  private lastCamera: SceneCamera | null = null;
  /** The scene the GM said is paused; only while it is the one shown. */
  private pausedScene: string | null = null;
  /** Every scene leaves here through this, so no drawer gets a grid it would loop over (`drawableGrid`). */
  private readonly drawable: (scene: PlayerScene | null) => PlayerScene | null;

  constructor(private readonly options: PlayerSceneInboxOptions) {
    let warned = false;
    this.drawable = drawableGridFilter((grid) => {
      if (warned) return;
      warned = true;
      (options.warn ?? ((message: string, details: unknown): void => console.warn(message, details)))(UNDRAWABLE_GRID_WARNING, grid);
    });
    this.mirror = new PlayerSceneMirror({
      sendResync: (seq) => options.sendResync(seq),
      onChange: (scene) => {
        // A new scene (another `sceneId`), or none, is not paused until the GM says so.
        if (this.pausedScene !== null && scene?.sceneId !== this.pausedScene) this.setPaused(null);
        options.onScene(this.drawable(scene));
      },
    });
  }

  /** Whether the scene shown is paused: the GM is on another scene, so moves are refused (D5). */
  get paused(): boolean {
    return this.pausedScene !== null;
  }

  /** The presented scene as this player has it, its grid dropped when it cannot be drawn; null while the GM shows none. */
  get scene(): PlayerScene | null {
    return this.drawable(this.mirror.scene);
  }

  /** The GM's latest camera; null before the first. */
  get camera(): SceneCamera | null {
    return this.lastCamera;
  }

  /** A message that failed to decode: broken scene data asks for a snapshot, a bad camera is only skipped (it is not scene data). */
  invalid(decoded: ReturnType<typeof decodeControl>): void {
    if (decoded.kind === 'invalid' && decoded.reason.startsWith('bad-scene-') && decoded.reason !== 'bad-scene-camera') this.mirror.invalid();
  }

  /** Applies a scene or camera message; false for any other message. */
  receive(message: ControlMessage): boolean {
    switch (message.type) {
      case 'scene-snapshot':
      case 'scene-fog':
      case 'scene-drawings':
      case 'scene-patch':
      case 'scene-clear':
        this.mirror.receive(message);
        return true;
      case 'scene-camera':
        this.lastCamera = cameraOfMessage(message);
        this.options.onCamera(this.lastCamera);
        return true;
      case 'scene-state':
        // For the scene shown only: one the player does not have is another scene's.
        if (message.sceneId === this.mirror.scene?.sceneId) this.setPaused(message.paused ? message.sceneId : null);
        return true;
      default:
        return false;
    }
  }

  dispose(): void {
    this.mirror.dispose();
  }

  private setPaused(sceneId: string | null): void {
    if (sceneId === this.pausedScene) return;
    this.pausedScene = sceneId;
    this.options.onPaused?.(sceneId !== null);
  }
}
