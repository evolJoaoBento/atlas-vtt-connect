/**
 * The player's side of a cutscene, shared by the Obsidian tab and the join page: what the view does when a run starts,
 * changes and ends.
 *
 * - A player on the 3D board whose board plays cutscenes: the board is handed the run and does everything.
 * - A player on the 2D map, with a board to make: a black overlay fades in over the view (`fadeMs`), a board is made
 *   beside the map (which stays, hidden, with its own pan and zoom) and given the run with `startBlack` and `handBack`;
 *   the overlay stays black under it. At the run's end the board fades to black by itself and calls `cutsceneOver`: the
 *   board is let go, the map shown under the black, and the overlay fades out.
 * - Anyone who cannot draw the run (no board, no WebGL, a board that fails, a Tabletop without cutscenes): a black
 *   curtain reading "The GM is showing a scene.", the tools locked, and no `cutscene-ready`, so no revealed map is sent.
 *
 * During a run the tools are locked (`setLocked`) and the view does not change (`running`). The stage owns the elements
 * it is given and the timers of the fades; jsdom has no transitions, so the fades are timed here.
 */
import type { BoardCutscene, BoardExtras, CutsceneCamera } from '../scene/boardTypes';
import type { PlayerScene } from '../scene/sceneTypes';
import type { BoardSceneView } from './BoardSceneView';

export const CURTAIN_TEXT = 'The GM is showing a scene.';

/** How long a handed-back board has, after the run ends, to reach its black before the map is put back anyway. */
const LEAVE_PATIENCE_MS = 15_000;

export interface CutsceneStageOptions {
  /** The 2D map's element, hidden (not disposed) while the board plays a handed-back run. */
  canvas: HTMLElement;
  /** Where the boards draw. */
  boardEl: HTMLElement;
  /** The black overlay that fades the 2D view; the stage toggles `hidden`, the class `is-black` and the fade length. */
  overlay: HTMLElement;
  /** The black curtain with its words. */
  curtain: HTMLElement;
  /** The board the player is on, or null on the 2D map. */
  board(): BoardSceneView | null;
  /** Whether a board can be made for a 2D player. */
  canMakeBoard(): boolean;
  /** Makes a board for a handed-back run, drawing in `boardEl` (still hidden); null where it cannot start. `over` is its `cutsceneOver`. */
  makeBoard(over: () => void): BoardSceneView | null;
  /** Gives a board just made what the session gave the tab (its scene, tools, players), after it has the run. */
  replay(board: BoardSceneView): void;
  /** Asks the GM for the revealed scenes (or stops asking); false when it cannot go now. */
  sendReady(on: boolean): boolean;
  /** The tools are locked or free (the toolbar, sheets and dice tray hide). */
  setLocked(locked: boolean): void;
  /** The run is over and the view is the player's own again: the tab picks its view anew. */
  finished(): void;
  win: Window;
}

type Mode = 'board' | 'handoff' | 'curtain';

export class CutsceneStage {
  private run: BoardCutscene | null = null;
  private mode: Mode | null = null;
  private readonly scenes = new Map<string, { scene: PlayerScene; extras: BoardExtras | null }>();
  private camera: ({ runId: string } & CutsceneCamera) | null = null;
  private runBoard: BoardSceneView | null = null;
  /** The handed-back board is in place (the fade in is done). */
  private active = false;
  private readyOn = false;
  private timer: number | null = null;
  private disposed = false;

  constructor(private readonly options: CutsceneStageOptions) {}

  /** A run is on (or being left): the view must not change. */
  get running(): boolean {
    return this.mode !== null;
  }

  /** The 2D map is hidden under a handed-back board: it must not be measured. */
  get hidesMap(): boolean {
    return this.mode === 'handoff';
  }

  /** The board made for a handed-back run, while it exists. */
  get handoffBoard(): BoardSceneView | null {
    return this.runBoard;
  }

  /** The session's state changed: a new admission asks for the revealed scenes again. */
  sessionChanged(admitted: boolean): void {
    if (!admitted) {
      this.readyOn = false;
      return;
    }
    if (this.run && (this.mode === 'board' || this.mode === 'handoff')) this.ready(true);
  }

  cutscene(cutscene: BoardCutscene | null): void {
    if (this.disposed) return;
    if (cutscene === null) {
      this.end();
      return;
    }
    const fresh = this.run?.runId !== cutscene.runId;
    if (fresh && this.mode !== null) this.cleanUp();
    this.run = cutscene;
    if (fresh) this.begin(cutscene);
    else if (this.mode === 'board') this.options.board()?.setCutscene(cutscene);
    else if (this.mode === 'handoff' && this.active) this.runBoard?.setCutscene(cutscene);
  }

  scene(runId: string, key: string, scene: PlayerScene, extras: BoardExtras | null): void {
    // A curtain draws nothing and keeps nothing.
    if (this.disposed || runId !== this.run?.runId || this.mode === 'curtain') return;
    this.scenes.set(key, { scene, extras });
    if (this.mode === 'board') this.options.board()?.setCutsceneScene(runId, key, scene, extras);
    else if (this.mode === 'handoff' && this.active) this.runBoard?.setCutsceneScene(runId, key, scene, extras);
  }

  cameraMoved(runId: string, camera: CutsceneCamera): void {
    if (this.disposed || runId !== this.run?.runId) return;
    this.camera = { runId, ...camera };
    if (this.mode === 'board') this.options.board()?.setCutsceneCamera(runId, camera);
    else if (this.mode === 'handoff' && this.active) this.runBoard?.setCutsceneCamera(runId, camera);
  }

  /**
   * A curtain only because the board's code has not arrived: when it does, the run is played after all (the player who
   * joined mid-run reaches the board, not the curtain for the whole run).
   */
  retry(): void {
    if (this.disposed || this.mode !== 'curtain' || !this.waitingForBoard || !this.run) return;
    if (!this.options.canMakeBoard()) return;
    const run = this.run;
    this.options.curtain.hidden = true;
    this.mode = null;
    this.begin(run);
  }

  private waitingForBoard = false;

  dispose(): void {
    // The GM stops sending revealed scenes to a tab that is gone.
    this.ready(false);
    this.disposed = true;
    this.clearTimer();
    this.runBoard?.dispose();
    this.runBoard = null;
  }

  private begin(run: BoardCutscene): void {
    const { options } = this;
    options.setLocked(true);
    const board = options.board();
    if (board) {
      if (!board.playsCutscenes) { this.curtain(); return; }
      this.mode = 'board';
      // Joining mid-run: the board must not show its framed map with the bars on the way in.
      board.setCutscene(run, run.step.seq > 1 ? { startBlack: true } : undefined);
      this.ready(true);
      this.replayScenes((key, entry) => board.setCutsceneScene(run.runId, key, entry.scene, entry.extras));
      return;
    }
    if (!options.canMakeBoard()) { this.curtain(true); return; }
    let made: BoardSceneView | null = null;
    try {
      made = options.makeBoard(() => this.over());
    } catch (error) {
      console.warn('[Atlas VTT Connect] The 3D board could not start for the cutscene:', error);
    }
    if (!made || !made.playsCutscenes) {
      made?.dispose();
      options.boardEl.hidden = true;
      this.curtain();
      return;
    }
    this.mode = 'handoff';
    this.active = false;
    this.runBoard = made;
    options.boardEl.hidden = true;
    this.fadeOverlay(true, run.look.fadeMs);
    this.ready(true);
    // The scene is black: the board takes the 2D map's place, under which the overlay stays.
    this.timer = options.win.setTimeout(() => this.activate(), run.look.fadeMs);
  }

  /** The overlay is black: the board, given the run before its first scene, takes the 2D map's place. */
  private activate(): void {
    const { options } = this;
    const board = this.runBoard;
    const run = this.run;
    this.timer = null;
    if (!board || !run || this.mode !== 'handoff') return;
    board.setCutscene(run, { startBlack: true, handBack: true });
    options.replay(board);
    this.active = true;
    // Upgraded from the curtain (the board's code arrived mid-run): the board takes over from its black.
    options.curtain.hidden = true;
    options.canvas.hidden = true;
    options.boardEl.hidden = false;
    options.boardEl.classList.add('is-cutscene');
    board.measure();
    this.replayScenes((key, entry) => board.setCutsceneScene(run.runId, key, entry.scene, entry.extras));
    if (this.camera?.runId === run.runId) board.setCutsceneCamera(run.runId, this.camera);
  }

  private curtain(waitingForBoard = false): void {
    this.mode = 'curtain';
    this.waitingForBoard = waitingForBoard;
    this.options.curtain.textContent = CURTAIN_TEXT;
    this.options.curtain.hidden = false;
    // Never ready: this client is sent no revealed map.
    this.ready(false);
  }

  private end(): void {
    const mode = this.mode;
    const run = this.run;
    this.run = null;
    this.scenes.clear();
    this.camera = null;
    if (mode === null) return;
    this.ready(false);
    if (mode === 'curtain') {
      this.finish();
    } else if (mode === 'board') {
      // The board fades out and gives the player their own camera back; the tools are theirs from now on.
      this.options.board()?.setCutscene(null);
      this.finish();
    } else if (!this.active) {
      // Ended while the overlay was still fading in: the map never went anywhere.
      this.clearTimer();
      this.runBoard?.dispose();
      this.runBoard = null;
      this.leaveOverlay(run?.look.fadeMs ?? 600);
    } else {
      // The board leaves by itself and calls `over` at its black.
      this.runBoard?.setCutscene(null, { handBack: true });
      // A board that never reaches its black must not keep the player locked.
      this.clearTimer();
      this.timer = this.options.win.setTimeout(() => this.over(), LEAVE_PATIENCE_MS);
    }
  }

  /** The handed-back board is at its black: let it go, show the 2D map under the black, and fade the overlay out. */
  private over(): void {
    if (this.mode !== 'handoff' || !this.active) return;
    const { options } = this;
    const fadeMs = this.lastFadeMs;
    this.runBoard?.dispose();
    this.runBoard = null;
    this.active = false;
    options.boardEl.hidden = true;
    options.boardEl.classList.remove('is-cutscene');
    options.canvas.hidden = false;
    this.leaveOverlay(fadeMs);
  }

  private lastFadeMs = 600;

  private leaveOverlay(fadeMs: number): void {
    this.options.canvas.hidden = false;
    this.options.boardEl.hidden = true;
    this.fadeOverlay(false, fadeMs);
    this.clearTimer();
    this.timer = this.options.win.setTimeout(() => {
      this.timer = null;
      this.options.overlay.hidden = true;
      this.finish();
    }, fadeMs);
  }

  private fadeOverlay(black: boolean, fadeMs: number): void {
    const { overlay } = this.options;
    this.lastFadeMs = fadeMs;
    overlay.style.transitionDuration = `${fadeMs}ms`;
    const wasHidden = overlay.hidden;
    overlay.hidden = false;
    // A transition does not run from display:none: the style is flushed before the class moves the opacity.
    if (wasHidden) void overlay.offsetHeight;
    overlay.classList.toggle('is-black', black);
  }

  /** The run is over for this view: the tools are free and the tab picks its view anew. */
  private finish(): void {
    this.options.curtain.hidden = true;
    this.mode = null;
    this.options.setLocked(false);
    this.options.finished();
  }

  /** A new run while one is still shown: the old one goes without a fade. */
  private cleanUp(): void {
    this.clearTimer();
    this.runBoard?.dispose();
    this.runBoard = null;
    this.active = false;
    this.scenes.clear();
    this.camera = null;
    const { options } = this;
    options.overlay.hidden = true;
    options.overlay.classList.remove('is-black');
    options.boardEl.classList.remove('is-cutscene');
    options.curtain.hidden = true;
    if (this.mode === 'handoff') {
      options.boardEl.hidden = true;
      options.canvas.hidden = false;
    }
    this.mode = null;
  }

  private replayScenes(give: (key: string, entry: { scene: PlayerScene; extras: BoardExtras | null }) => void): void {
    for (const [key, entry] of this.scenes) give(key, entry);
  }

  private ready(on: boolean): void {
    if (on === this.readyOn) return;
    this.readyOn = on;
    this.options.sendReady(on);
  }

  private clearTimer(): void {
    if (this.timer !== null) this.options.win.clearTimeout(this.timer);
    this.timer = null;
  }
}
