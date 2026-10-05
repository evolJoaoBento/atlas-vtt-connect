/**
 * What a lit scene hides from online players comes from a `LightingSource`: one `PresentationLighting` per
 * shown presentation, asked for a frame at each projection. With Atlas's `lighting` capability it reads the
 * player visibility (`liveLighting`); without it a scene saved lit fails closed (`noLightingCapability`).
 */
import type { LightingApi, SceneSnapshot } from '@atlas-vtt/api-types';
import { LiveLighting } from './LiveLighting';
import { closedFrame, OPEN_FRAME, type LightingFrame } from './lightingFrame';

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

/**
 * Atlas's answer decides, never the snapshot's lighting flag: `pending` is dark and `ready` is used though the
 * snapshot reads unlit (a map loading or a tab switch), and `unlit` on a scene saved lit is open, not closed:
 * with dynamic lighting off the player window shows the scene as unlit.
 */
export function liveLighting(lighting: Pick<LightingApi, 'playerVisibility' | 'watch'>): LightingSource {
  return {
    open: ({ viewId }, onDue) => {
      const live = new LiveLighting(lighting, viewId, onDue);
      return {
        frame: (snapshot) => live.frame(snapshot.mapSize) ?? (snapshot.lighting.enabled ? OPEN_FRAME : null),
        restart: () => live.restart(),
        dispose: () => live.dispose(),
      };
    },
  };
}
