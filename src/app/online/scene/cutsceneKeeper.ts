/**
 * What a joined client has heard of the cutscene running now: the run, and for each of its maps the revealed scene and
 * board extras, paired. Gives the news to the view (the tab or the page) and the files they name to the image loader, and
 * lets go of both when the run ends. A scene or extras of another run than the current one are dropped.
 */
import type { BoardCutscene, BoardExtras, CutsceneCamera } from './boardTypes';
import type { PlayerScene } from './sceneTypes';

/** What the view takes. */
export interface CutsceneSink {
  cutscene(cutscene: BoardCutscene | null): void;
  /** The revealed scene of `key` with its extras (null until they arrive); said again whenever either changes. */
  cutsceneScene(runId: string, key: string, scene: PlayerScene, extras: BoardExtras | null): void;
  cutsceneCamera(runId: string, camera: CutsceneCamera): void;
}

/** The image loader's side: it asks the GM for the files of these scenes while they are listed. */
export interface CutsceneAssets {
  setCutscene(scenes: ReadonlyArray<{ scene: PlayerScene; extras: BoardExtras | null }>): void;
}

export class CutsceneKeeper {
  private run: BoardCutscene | null = null;
  private readonly scenes = new Map<string, { scene: PlayerScene | null; extras: BoardExtras | null }>();

  constructor(private readonly assets: CutsceneAssets, private readonly sink: () => Partial<CutsceneSink> | null) {}

  get current(): BoardCutscene | null {
    return this.run;
  }

  cutscene(cutscene: BoardCutscene | null): void {
    if (cutscene?.runId !== this.run?.runId) {
      this.scenes.clear();
      this.lastCamera = null;
      this.assets.setCutscene([]);
    }
    this.run = cutscene;
    this.sink()?.cutscene?.(cutscene);
  }

  scene(runId: string, key: string, scene: PlayerScene): void {
    if (runId !== this.run?.runId) return;
    const entry = this.scenes.get(key) ?? { scene: null, extras: null };
    entry.scene = scene;
    this.scenes.set(key, entry);
    this.give(key, entry);
  }

  extras(runId: string, key: string, extras: BoardExtras): void {
    if (runId !== this.run?.runId) return;
    const entry = this.scenes.get(key) ?? { scene: null, extras: null };
    entry.extras = extras;
    this.scenes.set(key, entry);
    this.give(key, entry);
  }

  camera(runId: string, camera: CutsceneCamera): void {
    if (runId !== this.run?.runId) return;
    this.lastCamera = camera;
    this.sink()?.cutsceneCamera?.(runId, camera);
  }

  /** The GM's latest camera of a live run: a view that attaches mid-run needs it, the GM's may be at rest. */
  private lastCamera: CutsceneCamera | null = null;

  /** What is known so far, to a view that attaches. */
  replay(sink: Partial<CutsceneSink>): void {
    if (!this.run) return;
    sink.cutscene?.(this.run);
    for (const [key, entry] of this.scenes) if (entry.scene) sink.cutsceneScene?.(this.run.runId, key, entry.scene, entry.extras);
    if (this.lastCamera) sink.cutsceneCamera?.(this.run.runId, this.lastCamera);
  }

  private give(key: string, entry: { scene: PlayerScene | null; extras: BoardExtras | null }): void {
    this.assets.setCutscene([...this.scenes.values()].flatMap((each) => (each.scene ? [{ scene: each.scene, extras: each.extras }] : [])));
    if (entry.scene && this.run) this.sink()?.cutsceneScene?.(this.run.runId, key, entry.scene, entry.extras);
  }
}
