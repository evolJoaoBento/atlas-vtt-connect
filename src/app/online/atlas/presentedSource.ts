/**
 * The presented scene as online play reads it, through Atlas's `presentation` and `views`: nothing of
 * Atlas's stores. Replaces the fork's `PresentedSceneInfo` and `PresentedSceneSource`.
 *
 * Online play tells presentations apart by identity, as the fork did with Atlas's own scene objects: a
 * scene held while the GM browses another tab is the one players were shown, and it resumes as that
 * one; a presentation that starts held is a new one. The API hands out a fresh frozen info on every
 * call, so this keeps one `LiveScene` per presentation and gives the same object until it ends.
 */
import type { AtlasExtension, Disposer, PresentedSceneInfo, SceneSnapshot, ViewCamera } from '@atlas-vtt/api-types';

/** The presented scene as online play reads it: everything through the API, nothing of Atlas's store. */
export interface LiveScene {
  /** The latest info of this presentation (its `held` flag follows the events). */
  readonly info: PresentedSceneInfo;
  snapshot(): SceneSnapshot | null;
  subscribe(listener: (snapshot: SceneSnapshot) => void): Disposer;
  camera(): ViewCamera | null;
  watchCamera(listener: () => void): Disposer;
}
export interface PresentedSceneListener {
  presented?(scene: LiveScene, resumed: boolean): void;
  held?(scene: LiveScene): void;
  cleared?(previous: LiveScene): void;
}
export interface PresentedSceneSource {
  current(): LiveScene | null;
  isHeld(): boolean;
  subscribe(listener: PresentedSceneListener): Disposer;
}

type Atlas = Pick<AtlasExtension, 'presentation' | 'views'>;

interface Presentation {
  readonly scene: LiveScene;
  update(info: PresentedSceneInfo): void;
}

function presentation(atlas: Atlas, first: PresentedSceneInfo): Presentation {
  let info = first;
  const scene: LiveScene = {
    get info(): PresentedSceneInfo { return info; },
    snapshot: () => atlas.views.snapshot(info.viewId),
    subscribe: (listener) => atlas.views.subscribe(info.viewId, listener),
    camera: () => atlas.views.camera(info.viewId),
    watchCamera: (listener) => atlas.views.watchCamera(info.viewId, () => listener()),
  };
  return { scene, update: (next) => { info = next; } };
}

const samePlace = (a: PresentedSceneInfo, b: PresentedSceneInfo): boolean => a.viewId === b.viewId && a.tabId === b.tabId;

export function presentedSource(atlas: Atlas): PresentedSceneSource {
  const listeners = new Set<PresentedSceneListener>();
  let stopWatching: Disposer | null = null;
  let known: Presentation | null = null;

  /** The known presentation when `info` continues it, else a new one, which becomes the known one. */
  const adopt = (info: PresentedSceneInfo, continues: boolean): LiveScene => {
    if (known && continues && samePlace(known.scene.info, info)) {
      known.update(info);
      return known.scene;
    }
    known = presentation(atlas, info);
    return known.scene;
  };
  /** A hold while the view shows the presented tab is a presentation that starts held (its map not loaded): a new one. */
  const browsedAway = (info: PresentedSceneInfo): boolean =>
    atlas.views.list().find((view) => view.viewId === info.viewId)?.activeTabId !== info.tabId;
  const emit = (call: (listener: PresentedSceneListener) => void): void => {
    for (const listener of [...listeners]) {
      try {
        call(listener);
      } catch (error) {
        console.error('[Atlas VTT Connect] A presented scene listener failed:', error);
      }
    }
  };
  const watch = (): Disposer => atlas.presentation.subscribe({
    presented: (info, resumed) => {
      const scene = adopt(info, resumed);
      emit((listener) => listener.presented?.(scene, resumed));
    },
    held: (info) => {
      const scene = adopt(info, browsedAway(info));
      emit((listener) => listener.held?.(scene));
    },
    cleared: (info) => {
      const scene = adopt(info, true);
      known = null;
      emit((listener) => listener.cleared?.(scene));
    },
  });

  return {
    current: () => {
      const info = atlas.presentation.current();
      return info ? adopt(info, true) : null;
    },
    isHeld: () => atlas.presentation.current()?.held === true,
    // One subscription to Atlas for every listener, so each event decides once which presentation it is.
    subscribe: (listener) => {
      stopWatching ??= watch();
      listeners.add(listener);
      let live = true;
      return () => {
        if (!live) return;
        live = false;
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopWatching?.();
        stopWatching = null;
      };
    },
  };
}
