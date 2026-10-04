/**
 * What a lit scene hides from online players comes from a `LightingSource`: one `PresentationLighting` per
 * shown presentation, asked for a frame at each projection. This file holds the source for an Atlas
 * without the `lighting` capability; the source that reads Atlas's player visibility is `LiveLighting`.
 */
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import { closedFrame, type LightingFrame } from './lightingFrame';

export const LIT_SCENE_NEEDS_UPDATE_NOTICE = 'Update Atlas VTT to show lit scenes to online players.';

/** The lighting of one shown presentation. */
export interface PresentationLighting {
  /** Null while the scene shows unlit: the projection is then as without lighting. */
  frame(snapshot: SceneSnapshot): LightingFrame | null;
  /** The store holds the scene anew (reloaded in place): nothing worked out for it before stands in. */
  restart(): void;
  dispose(): void;
}

export interface LightingSource {
  /** The lighting of the presentation of `viewId` as players know it (`sceneId`); `onDue` asks for a projection. */
  open(scene: { viewId: string; sceneId: string }, onDue: () => void): PresentationLighting;
}

/**
 * Without Atlas's lighting nothing tells what a lit scene shows, so it fails closed (ruling L4: unknown is
 * dark): a scene saved lit gets the closed frame, and the GM is told once per scene.
 */
export function noLightingCapability(notify: (message: string) => void): LightingSource {
  let toldFor: string | null = null;
  return {
    open: ({ sceneId }) => ({
      frame: (snapshot) => {
        if (!snapshot.lighting.enabled) return null;
        if (toldFor !== sceneId) {
          toldFor = sceneId;
          notify(LIT_SCENE_NEEDS_UPDATE_NOTICE);
        }
        return closedFrame(snapshot.mapSize);
      },
      restart: () => undefined,
      dispose: () => undefined,
    }),
  };
}
