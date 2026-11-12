// online-client/sceneSwitch.mts
/**
 * The page's scene view: the 2D map, or Tabletop's 3D board while the GM offers it and the player wants it (the 2D/3D
 * button), as Connect's player tab in Obsidian switches (`CanvasScene`). The board's code is a chunk of its own, loaded
 * the first time the GM offers a board; until then, and if it cannot load or start, the 2D map shows. A change of view
 * keeps all the session gave the page and asks the GM for the board (or stops asking).
 *
 * On the board, the Eyes button sees through one of the player's tokens: the camera at its eye height, turned by the
 * phone's gyroscope (iOS asks the player first) and by a drag. The AR button shows the board through the phone's back
 * camera, standing on the printed marker sheet (`ar/arMode.mts`, a chunk of its own).
 */
import type { MapSpell, SpellRequest } from '../src/app/online/tools/spells';
import type { BoardSceneView } from '../src/app/online/obsidian/BoardSceneView';
import type { PlayerBoardFactory } from '../src/app/online/obsidian/playerBoardContract';
import type { SceneViewport } from '../src/app/online/obsidian/sceneViewport';
import type { BoardCamera, BoardCutscene, BoardExtras } from '../src/app/online/scene/boardTypes';
import { CutsceneStage } from '../src/app/online/obsidian/CutsceneStage';
import type { SceneCamera } from '../src/app/online/scene/sceneCamera';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import type { PinNoteAnswer } from '../src/app/online/tools/pinNotes';
import type { PlayerPing } from '../src/app/online/tools/pings';
import type { TokenSheet } from '../src/app/online/tools/sheets';
import type { MapTemplate, TemplateShape } from '../src/app/online/tools/templates';
import type { PlayerLaser } from '../src/app/online/tools/toolMessages';
import type { ArPose } from '../src/app/online/tools/arViews';
import type { ArSurvey } from '../src/app/online/tools/arTable';
import type { MeasureChoice } from '../src/app/online/view/tools/MeasureTool';
import type { PlayerTool } from '../src/app/online/view/tools/PlayerTools';
import type { ToolState } from './mapView.mts';
import type { ArMode } from './ar/arMode.mts';
import { readArSettings } from './ar/arPrefs.mts';
import { toolIconUrl, type ToolIconName } from '../src/app/online/page/toolIcons';
import { iconElement, setIcon } from './icons.mts';

/** A toolbar button's words (its tooltip and label) and icon. */
function label(button: HTMLButtonElement, words: string, icon: ToolIconName): void {
  button.setAttribute('aria-label', words);
  button.dataset.label = words;
  if (!button.querySelector('.tool-icon')) button.replaceChildren(iconElement(toolIconUrl(icon)));
  else setIcon(button, toolIconUrl(icon));
}

export interface SceneSwitchOptions {
  /** The board went into a token's eyes or came out: Tabletop's spell toolbar stands in for the page's meanwhile. */
  onSeeing?(seeing: boolean): void;
  /** The 2D map, made anew each time it shows. */
  makeMap(): SceneViewport;
  /** Tabletop's board, drawing in `boardEl`; `over` is a handed-back cutscene's `cutsceneOver`. */
  makeBoard(factory: PlayerBoardFactory, parent: HTMLElement, over?: () => void): BoardSceneView;
  /** A cutscene: the black the 2D map fades into, the curtain of a client that cannot draw it, and the tools' lock. */
  cutscene?: {
    overlay: HTMLElement;
    curtain: HTMLElement;
    sendReady(on: boolean): boolean;
    onLock(locked: boolean): void;
    /** Room AR stopped for a run: this button (in the page) starts it again, with the board where it was put. */
    backButton?: HTMLButtonElement;
  };
  /** Loads the board's chunk. */
  loadBoard(): Promise<PlayerBoardFactory>;
  canvas: HTMLElement;
  boardEl: HTMLElement;
  dimensionButton: HTMLButtonElement;
  eyeButton: HTMLButtonElement;
  eyeMenu: HTMLElement;
  /** Follow GM and Fit map: the 2D map shows them itself; on the board they show with a scene. */
  viewButtons: HTMLElement;
  /** Asks the GM for the board extras (or stops asking); false while it cannot be asked yet. */
  requestBoard(on: boolean): boolean;
  /** The view changed: the toolbar follows. */
  onViewChange(): void;
  /** A token's name, for the Eyes menu. */
  tokenName(tokenId: string): string;
  /** Tells the GM where the phone's camera is in augmented reality (the eye on the GM's board). */
  sendArView?(pose: ArPose | null): boolean;
  /** Sends the GM this phone's survey of the table's marker sheets. */
  sendArSurvey?(survey: ArSurvey): boolean;
  /** Augmented reality: its button, the panel it fills, and the video the camera's picture plays in. */
  ar?: { button: HTMLButtonElement; panel: HTMLElement; video: HTMLVideoElement; overlay?: HTMLElement };
  onError?(message: string, error: unknown): void;
}

export class SceneSwitch implements SceneViewport {
  private view: SceneViewport;
  private board: BoardSceneView | null = null;
  private factory: PlayerBoardFactory | null = null;
  private loading = false;
  private offered = false;
  private wantsBoard = true;
  /** The GM holds a request of ours for this offer. */
  private asked = false;
  private disposed = false;
  // All the session gave, for a view shown anew.
  private scene: PlayerScene | null = null;
  private sheets: readonly TokenSheet[] = [];
  private gmCamera: SceneCamera | null = null;
  private controlled: readonly string[] = [];
  private spells: { sceneId: string; list: readonly MapSpell[]; asks: readonly SpellRequest[] } | null = null;
  /** The player's colour, for a view made anew. */
  private laserColor: string | null = null;
  private connected = false;
  private paused = false;
  private players: { order: readonly string[]; self: string | null } = { order: [], self: null };
  private templates: { sceneId: string; list: readonly MapTemplate[] } | null = null;
  private extras: BoardExtras | null = null;
  private boardCamera: BoardCamera | null = null;
  private readonly stops: Array<() => void> = [];
  private ar: ArMode | null = null;
  private arStarting = false;
  /** Whether this phone tracks the room in the browser (WebXR immersive AR: Android's ARCore); asked once, before any tap. */
  private roomSupported = false;
  private roomAsked = false;

  private readonly stage: CutsceneStage | null;

  constructor(private readonly options: SceneSwitchOptions) {
    const cut = options.cutscene;
    this.stage = cut ? new CutsceneStage({
      canvas: options.canvas, boardEl: options.boardEl, overlay: cut.overlay, curtain: cut.curtain, win: window,
      board: () => this.board,
      canMakeBoard: () => this.factory !== null,
      makeBoard: (over) => {
        const factory = this.factory;
        return factory ? options.makeBoard(factory, options.boardEl, over) : null;
      },
      replay: (board) => this.replayInto(board, board),
      sendReady: (on) => cut.sendReady(on),
      setLocked: (locked) => { cut.onLock(locked); this.showEyes(); },
      finished: () => { this.choose(); this.view.measure(); this.showEyes(); },
    }) : null;
    this.view = options.makeMap();
    const listen = (target: EventTarget, type: string, handler: (event: Event) => void): void => {
      target.addEventListener(type, handler);
      this.stops.push(() => target.removeEventListener(type, handler));
    };
    listen(options.dimensionButton, 'click', () => {
      this.wantsBoard = !this.wantsBoard;
      this.choose();
    });
    listen(options.eyeButton, 'click', () => this.eyeClicked());
    if (options.ar) listen(options.ar.button, 'click', () => this.arClicked());
    if (cut?.backButton) {
      cut.backButton.hidden = true;
      listen(cut.backButton, 'click', () => this.backToAr());
    }
    // A tap anywhere else closes the Eyes menu.
    listen(options.eyeMenu.ownerDocument, 'pointerdown', (event) => {
      const target = event.target as Node | null;
      if (!options.eyeMenu.hidden && target && !options.eyeMenu.contains(target) && !options.eyeButton.contains(target)) options.eyeMenu.hidden = true;
      // And the AR menu.
      const ar = options.ar;
      if (ar && !ar.panel.hidden && target && !ar.panel.contains(target) && !ar.button.contains(target)) ar.panel.hidden = true;
    });
    this.choose();
  }

  /** Whether the 3D board is showing. */
  get showsBoard(): boolean {
    return this.board !== null;
  }

  /** The board, while it shows (for its dice). */
  get boardView(): BoardSceneView | null {
    return this.board;
  }

  /** Whether the GM can send the board now; loads the board's code the first time. */
  boardOffer(available: boolean): void {
    this.offered = available;
    // Offered anew (a new admission): the GM holds no request of ours.
    this.asked = false;
    if (available && !this.factory && !this.loading) {
      this.loading = true;
      this.options.loadBoard().then((factory) => {
        this.factory = factory;
      }, (error: unknown) => {
        this.options.onError?.('The 3D board could not load; the map stays 2D.', error);
      }).finally(() => {
        this.loading = false;
        this.choose();
      });
    }
    this.choose();
  }

  boardExtras(extras: BoardExtras | null): void {
    this.extras = extras;
    this.board?.setExtras(extras);
  }

  setBoardCamera(camera: BoardCamera | null): void {
    this.boardCamera = camera;
    this.board?.setBoardCamera(camera);
  }

  /** The cutscene running now (again whenever it changes), or null when it ended or the link dropped. */
  cutscene(cutscene: BoardCutscene | null): void {
    if (!this.stage) return;
    const wasRunning = this.stage.running;
    this.stage.cutscene(cutscene);
    // Room AR cannot draw a driven camera: its session ends for the run (marker AR goes on under the locked board and
    // resumes by itself); a WebXR session starts only from a tap, so the player is offered Back to AR afterwards.
    if (cutscene && !wasRunning) this.ar?.suspendRoom();
    if (!cutscene) this.showBackToAr();
  }

  cutsceneScene(runId: string, key: string, scene: PlayerScene, extras: BoardExtras | null): void {
    this.stage?.scene(runId, key, scene, extras);
  }

  cutsceneCamera(runId: string, camera: { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }): void {
    this.stage?.cameraMoved(runId, camera);
  }

  /** The Back to AR button shows while room AR waits for a tap after a run. */
  private showBackToAr(): void {
    const back = this.options.cutscene?.backButton;
    if (back) back.hidden = this.ar?.roomSuspended !== true;
  }

  private backToAr(): void {
    const ar = this.ar;
    const back = this.options.cutscene?.backButton;
    if (!ar?.roomSuspended) { if (back) back.hidden = true; return; }
    if (back) back.hidden = true;
    ar.resumeRoom(this.requestRoomSession());
  }

  /** Asks for a WebXR immersive AR session; inside a tap. */
  private requestRoomSession(): Promise<unknown> {
    const xr = (navigator as Navigator & { xr?: { requestSession: (mode: string, init: unknown) => Promise<unknown> } }).xr!;
    const overlay = this.options.ar?.overlay;
    const session = xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], ...(overlay ? { domOverlay: { root: overlay } } : {}) });
    session.catch(() => undefined);
    return session;
  }

  /** The board while it can be shown and is wanted; else the 2D map. A board that will not start leaves the map. */
  private choose(): void {
    // The view stays as it is during a cutscene; it is chosen anew when the run is over.
    if (this.disposed || this.stage?.running) return;
    const possible = this.factory !== null && this.offered;
    const wanted = possible && this.wantsBoard;
    const { dimensionButton, canvas, boardEl } = this.options;
    dimensionButton.hidden = !possible;
    label(dimensionButton, wanted ? 'Show the 2D map' : 'Show the 3D board', wanted ? 'map' : 'box');
    if (wanted && !this.asked) this.asked = this.options.requestBoard(true);
    if (wanted === (this.board !== null)) { this.showEyes(); return; }
    let next: SceneViewport | null = null;
    let board: BoardSceneView | null = null;
    if (wanted && this.factory) {
      try {
        boardEl.hidden = false;
        board = this.options.makeBoard(this.factory, boardEl);
        next = board;
      } catch (error) {
        boardEl.hidden = true;
        this.factory = null;
        this.options.onError?.('The 3D board could not start; the map stays 2D.', error);
        dimensionButton.hidden = true;
      }
    }
    this.ar?.end();
    this.view.dispose();
    if (!next) {
      if (this.asked && this.offered) this.options.requestBoard(false);
      this.asked = false;
      // The board's news belong to the board shown: a board shown again waits for the GM's again.
      this.extras = null;
      this.boardCamera = null;
      next = this.options.makeMap();
    }
    this.board = board;
    this.view = next;
    canvas.hidden = board !== null;
    boardEl.hidden = board === null;
    this.replay();
    if (board) this.options.viewButtons.hidden = this.scene === null;
    this.showEyes();
    this.options.onViewChange();
  }

  /** What the session gave, to the view just made. */
  private replay(): void {
    this.replayInto(this.view, this.board);
  }

  /** What the session gave, to `view`: the one just made, or a board made for a cutscene (`board` is `view` when it is one). */
  private replayInto(view: SceneViewport, board: BoardSceneView | null): void {
    view.setPlayers(this.players.order, this.players.self);
    view.setConnected(this.connected);
    view.setControlled(this.controlled);
    view.setPaused(this.paused);
    view.setSheets(this.sheets);
    view.setScene(this.scene);
    view.setGmCamera(this.gmCamera);
    if (this.templates) view.receiveTemplates(this.templates.sceneId, this.templates.list);
    if (board && this.spells) board.receiveSpells(this.spells.sceneId, this.spells.list, this.spells.asks);
    if (this.laserColor) view.selectLaserColor(this.laserColor);
    if (board) {
      board.setExtras(this.extras);
      board.setBoardCamera(this.boardCamera);
    }
    view.measure();
  }

  /** The Eyes button: on the board, with a token of the player's to see through. */
  private showEyes(): void {
    const { eyeButton, eyeMenu } = this.options;
    const inAr = this.ar?.active === true;
    const ar = this.options.ar;
    if (ar && this.board?.augmentedReality === true && !this.roomAsked) this.askRoom();
    if (ar) {
      ar.button.hidden = this.board?.augmentedReality !== true;
      // Its face the word AR (plainer than any icon for it); the tooltip says the rest.
      const words = inAr ? 'AR settings' : 'AR: the board on your table';
      ar.button.setAttribute('aria-label', words);
      ar.button.dataset.label = words;
      if (ar.button.querySelector('.tool-icon') || ar.button.textContent !== 'AR') {
        const face = document.createElement('span');
        face.className = 'tool-word';
        face.textContent = 'AR';
        ar.button.replaceChildren(face);
      }
      ar.button.setAttribute('aria-pressed', String(inAr));
      ar.button.classList.toggle('is-active', inAr);
    }
    const can = this.board?.firstPerson === true && this.controlled.length > 0 && !inAr;
    eyeButton.hidden = !can;
    const seeing = this.board?.seeingFrom() ?? null;
    label(eyeButton, seeing ? 'Leave the token\'s eyes' : 'See through a token\'s eyes', 'eye');
    eyeButton.setAttribute('aria-pressed', String(seeing !== null));
    eyeButton.classList.toggle('is-active', seeing !== null);
    if (!can) eyeMenu.hidden = true;
    this.options.onSeeing?.(seeing !== null && this.board !== null);
  }

  /**
   * AR: the board over the phone's back camera. The camera is asked for at once, inside the tap (iOS wants it so); the
   * code that tracks the sheet loads meanwhile.
   */
  /** Asks the browser, ahead of any tap, whether it tracks the room: the tap itself must ask for the session at once. */
  private askRoom(): void {
    this.roomAsked = true;
    const xr = (navigator as Navigator & { xr?: { isSessionSupported?: (mode: string) => Promise<boolean> } }).xr;
    xr?.isSessionSupported?.('immersive-ar').then((supported) => { this.roomSupported = supported === true; }, () => undefined);
  }

  private arClicked(): void {
    const ar = this.options.ar;
    if (!ar) return;
    // While AR is on, its button opens its menu (Leave AR is in there).
    if (this.ar?.active) { this.ar.toggleMenu(); return; }
    this.startAr();
  }

  /** Starts AR with the tracking chosen; inside a tap (the camera, the gyroscope or the room session are asked for at once). */
  private startAr(): void {
    const ar = this.options.ar;
    if (!ar) return;
    const board = this.board;
    if (!board?.augmentedReality || this.arStarting) return;
    const roomCapable = this.roomSupported && board.roomAr;
    if (roomCapable && readArSettings().tracking === 'room') {
      // Room tracking: the session asked for inside the tap; ARCore has the camera (no getUserMedia here).
      const session = this.requestRoomSession();
      this.loadAr(board, { stream: null, session, roomCapable: true }, () => { session.then((s) => (s as { end(): Promise<void> }).end(), () => undefined).catch(() => undefined); });
      return;
    }
    // The gyroscope steadies the board: iOS asks for it, from inside the tap, before anything is awaited.
    const sensor = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    const motion = typeof sensor?.requestPermission === 'function'
      ? sensor.requestPermission().then((answer) => answer === 'granted', () => false)
      : Promise.resolve(sensor !== undefined);
    const media = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
    const stream = typeof media?.getUserMedia === 'function'
      ? media.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      : Promise.reject(new Error('This browser gives the page no camera.'));
    stream.catch(() => undefined);
    const release = (): void => { stream.then((s) => { for (const track of s.getTracks()) track.stop(); }, () => undefined); };
    this.loadAr(board, { stream, motion, roomCapable }, release);
  }

  /** Loads the AR code (a chunk of its own) and starts it; `release` lets go of what the tap asked for if it cannot. */
  private loadAr(board: BoardSceneView, start: Pick<import('./ar/arMode.mts').ArModeOptions, 'stream' | 'motion' | 'session' | 'roomCapable'>, release: () => void): void {
    const ar = this.options.ar;
    if (!ar) return;
    this.arStarting = true;
    import('./ar/arMode.mts').then(({ ArMode }) => {
      if (this.disposed || this.board !== board) { release(); return; }
      this.ar = new ArMode({
        ...start, video: ar.video, boardEl: this.options.boardEl, panel: ar.panel, ...(ar.overlay ? { overlay: ar.overlay } : {}),
        board: () => this.board,
        tokens: () => this.controlled.map((id) => ({ id, name: this.options.tokenName(id) })),
        ...(this.options.sendArView ? { sendView: (pose: ArPose | null) => this.options.sendArView?.(pose) ?? false } : {}),
        ...(this.options.sendArSurvey ? { sendSurvey: (survey: ArSurvey) => this.options.sendArSurvey?.(survey) ?? false } : {}),
        onEnd: () => { this.ar = null; this.showEyes(); this.showBackToAr(); },
        // The other tracking, chosen in the menu: this one ends and the other starts, inside the same tap.
        onSwitch: () => {
          this.ar?.end();
          this.startAr();
        },
      });
      this.showEyes();
    }, (error: unknown) => {
      release();
      this.options.onError?.('Augmented reality could not load.', error);
    }).finally(() => { this.arStarting = false; });
  }

  private eyeClicked(): void {
    const board = this.board;
    if (!board) return;
    if (board.seeingFrom() !== null) {
      board.seeFrom(null, false);
      this.showEyes();
      return;
    }
    if (this.controlled.length === 1) { this.seeFrom(this.controlled[0]!); return; }
    // Several tokens: the player picks one.
    const { eyeMenu } = this.options;
    eyeMenu.replaceChildren(...this.controlled.map((tokenId) => {
      const item = eyeMenu.ownerDocument.createElement('button');
      item.type = 'button';
      item.className = 'menu-entry';
      item.setAttribute('role', 'menuitem');
      item.textContent = this.options.tokenName(tokenId);
      item.addEventListener('click', () => { eyeMenu.hidden = true; this.seeFrom(tokenId); });
      return item;
    }));
    eyeMenu.hidden = !eyeMenu.hidden;
  }

  /**
   * Sees through `tokenId`'s eyes. iOS lets a page read the gyroscope only once the player allows it, asked from inside
   * the tap itself: so the question goes first, before anything is awaited. Without it (refused, or no gyroscope) a drag
   * turns the view.
   */
  private seeFrom(tokenId: string): void {
    const sensor = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    const asked = typeof sensor?.requestPermission === 'function' ? sensor.requestPermission() : Promise.resolve(sensor ? 'granted' : 'denied');
    asked.catch(() => 'denied').then((answer) => {
      this.board?.seeFrom(tokenId, answer === 'granted');
      this.showEyes();
    }, () => undefined);
  }

  // The scene view, remembered for a view shown anew.
  setScene(scene: PlayerScene | null): void {
    this.scene = scene;
    this.view.setScene(scene);
    if (this.board) this.options.viewButtons.hidden = scene === null;
    this.showEyes();
  }

  setSheets(entries: readonly TokenSheet[]): void { this.sheets = entries; this.view.setSheets(entries); }
  setGmCamera(camera: SceneCamera | null): void { this.gmCamera = camera; this.view.setGmCamera(camera); }
  setControlled(tokenIds: readonly string[]): void {
    this.controlled = tokenIds;
    this.view.setControlled(tokenIds);
    // A token no longer the player's is not seen through.
    const seeing = this.board?.seeingFrom() ?? null;
    if (seeing !== null && !tokenIds.includes(seeing)) this.board?.seeFrom(null, false);
    this.ar?.fillAnchors();
    this.showEyes();
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
    this.stage?.sessionChanged(connected);
    this.view.setConnected(connected);
    if (!connected) this.asked = false;
    else this.choose();
  }

  moveRefused(tokenId: string): void { this.view.moveRefused(tokenId); }
  setPaused(paused: boolean): void { this.paused = paused; this.view.setPaused(paused); }
  selectTool(tool: PlayerTool): void { this.view.selectTool(tool); }
  followGm(): void { this.view.followGm(); }
  fitMap(): void { this.view.fitMap(); }
  selectTemplateShape(shape: TemplateShape): void { this.view.selectTemplateShape(shape); }
  clearOwnTemplates(): void { this.view.clearOwnTemplates(); }
  selectShape(shape: MeasureChoice): void { this.view.selectShape(shape); }
  selectLaserColor(color: string): void { this.laserColor = color; this.view.selectLaserColor(color); }
  selectLaserSize(size: number): void { this.view.selectLaserSize(size); }
  toolState(): ToolState { return this.view.toolState(); }
  setPlayers(order: readonly string[], self: string | null): void { this.players = { order, self }; this.view.setPlayers(order, self); }
  receiveNote(answer: PinNoteAnswer): void { this.view.receiveNote(answer); }
  receiveTemplates(sceneId: string, templates: readonly MapTemplate[]): void { this.templates = { sceneId, list: templates }; this.view.receiveTemplates(sceneId, templates); }
  /** The scene's spells: the 3D board draws them (the 2D map has none). */
  receiveSpells(sceneId: string, spells: readonly MapSpell[], asks: readonly SpellRequest[] = []): void { this.spells = { sceneId, list: spells, asks }; this.board?.receiveSpells(sceneId, spells, asks); }
  /** The board left a token's eyes by itself (Escape, Leave): the Eyes button follows. */
  eyesChanged(): void { this.showEyes(); }
  receivePing(ping: PlayerPing): void { this.view.receivePing(ping); }
  receiveLaser(laser: PlayerLaser): void { this.view.receiveLaser(laser); }
  refresh(): void { this.view.refresh(); }
  measure(): void {
    // The 2D map kept under a cutscene's board has no size to measure; the board has.
    if (this.stage?.hidesMap) this.stage.handoffBoard?.measure();
    else this.view.measure();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stage?.dispose();
    this.ar?.end();
    for (const stop of this.stops) stop();
    this.view.dispose();
  }
}
