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
import type { BoardSceneView } from '../src/app/online/obsidian/BoardSceneView';
import type { PlayerBoardFactory } from '../src/app/online/obsidian/playerBoardContract';
import type { SceneViewport } from '../src/app/online/obsidian/sceneViewport';
import type { BoardCamera, BoardExtras } from '../src/app/online/scene/boardTypes';
import type { SceneCamera } from '../src/app/online/scene/sceneCamera';
import type { PlayerScene } from '../src/app/online/scene/sceneTypes';
import type { PinNoteAnswer } from '../src/app/online/tools/pinNotes';
import type { PlayerPing } from '../src/app/online/tools/pings';
import type { TokenSheet } from '../src/app/online/tools/sheets';
import type { MapTemplate, TemplateShape } from '../src/app/online/tools/templates';
import type { PlayerLaser } from '../src/app/online/tools/toolMessages';
import type { MeasureChoice } from '../src/app/online/view/tools/MeasureTool';
import type { PlayerTool } from '../src/app/online/view/tools/PlayerTools';
import type { ToolState } from './mapView.mts';
import type { ArMode } from './ar/arMode.mts';
import { readArSettings } from './ar/arPrefs.mts';

export interface SceneSwitchOptions {
  /** The 2D map, made anew each time it shows. */
  makeMap(): SceneViewport;
  /** Tabletop's board, drawing in `boardEl`. */
  makeBoard(factory: PlayerBoardFactory, parent: HTMLElement): BoardSceneView;
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

  constructor(private readonly options: SceneSwitchOptions) {
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
    // A tap anywhere else closes the Eyes menu.
    listen(options.eyeMenu.ownerDocument, 'pointerdown', (event) => {
      const target = event.target as Node | null;
      if (!options.eyeMenu.hidden && target && !options.eyeMenu.contains(target) && !options.eyeButton.contains(target)) options.eyeMenu.hidden = true;
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

  /** The board while it can be shown and is wanted; else the 2D map. A board that will not start leaves the map. */
  private choose(): void {
    if (this.disposed) return;
    const possible = this.factory !== null && this.offered;
    const wanted = possible && this.wantsBoard;
    const { dimensionButton, canvas, boardEl } = this.options;
    dimensionButton.hidden = !possible;
    dimensionButton.textContent = wanted ? '2D' : '3D';
    dimensionButton.setAttribute('aria-label', wanted ? 'Show the 2D map' : 'Show the 3D board');
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
    const view = this.view;
    view.setPlayers(this.players.order, this.players.self);
    view.setConnected(this.connected);
    view.setControlled(this.controlled);
    view.setPaused(this.paused);
    view.setSheets(this.sheets);
    view.setScene(this.scene);
    view.setGmCamera(this.gmCamera);
    if (this.templates) view.receiveTemplates(this.templates.sceneId, this.templates.list);
    if (this.board) {
      this.board.setExtras(this.extras);
      this.board.setBoardCamera(this.boardCamera);
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
      ar.button.textContent = inAr ? 'Leave AR' : 'AR';
      ar.button.setAttribute('aria-pressed', String(inAr));
    }
    const can = this.board?.firstPerson === true && this.controlled.length > 0 && !inAr;
    eyeButton.hidden = !can;
    const seeing = this.board?.seeingFrom() ?? null;
    eyeButton.textContent = seeing ? 'Leave eyes' : 'Eyes';
    eyeButton.setAttribute('aria-pressed', String(seeing !== null));
    if (!can) eyeMenu.hidden = true;
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
    if (this.ar?.active) { this.ar.end(); return; }
    const board = this.board;
    if (!board?.augmentedReality || this.arStarting) return;
    const roomCapable = this.roomSupported && board.roomAr;
    if (roomCapable && readArSettings().tracking === 'room') {
      // Room tracking: the session asked for inside the tap; ARCore has the camera (no getUserMedia here).
      const xr = (navigator as Navigator & { xr?: { requestSession: (mode: string, init: unknown) => Promise<unknown> } }).xr!;
      const overlay = ar.overlay;
      const session = xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], ...(overlay ? { domOverlay: { root: overlay } } : {}) });
      session.catch(() => undefined);
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
        onEnd: () => { this.ar = null; this.showEyes(); },
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
  selectLaserColor(color: string): void { this.view.selectLaserColor(color); }
  selectLaserSize(size: number): void { this.view.selectLaserSize(size); }
  toolState(): ToolState { return this.view.toolState(); }
  setPlayers(order: readonly string[], self: string | null): void { this.players = { order, self }; this.view.setPlayers(order, self); }
  receiveNote(answer: PinNoteAnswer): void { this.view.receiveNote(answer); }
  receiveTemplates(sceneId: string, templates: readonly MapTemplate[]): void { this.templates = { sceneId, list: templates }; this.view.receiveTemplates(sceneId, templates); }
  receivePing(ping: PlayerPing): void { this.view.receivePing(ping); }
  receiveLaser(laser: PlayerLaser): void { this.view.receiveLaser(laser); }
  refresh(): void { this.view.refresh(); }
  measure(): void { this.view.measure(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ar?.end();
    for (const stop of this.stops) stop();
    this.view.dispose();
  }
}
