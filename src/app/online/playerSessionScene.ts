/**
 * The scene and camera half of a player's session: the mirror of the GM's presented
 * scene (snapshots, patches, resyncs) and the GM's latest camera. Shared with the web
 * player page, so it imports nothing from Obsidian.
 */
import { decodeControl, type ControlMessage } from './protocol';
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
}

export class PlayerSceneInbox {
  private readonly mirror: PlayerSceneMirror;
  private lastCamera: SceneCamera | null = null;

  constructor(private readonly options: PlayerSceneInboxOptions) {
    this.mirror = new PlayerSceneMirror({ sendResync: (seq) => options.sendResync(seq), onChange: (scene) => options.onScene(scene) });
  }

  /** The presented scene as this player has it; null while the GM shows none. */
  get scene(): PlayerScene | null {
    return this.mirror.scene;
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
      default:
        return false;
    }
  }

  dispose(): void {
    this.mirror.dispose();
  }
}
