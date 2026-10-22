/**
 * The Canvas 2D scene tab's wiring, without the Obsidian view around it: the joined session's sink. It draws the
 * presented scene with the join page's own map, tools, dice tray and dice log (`MapView`, `PageToolbar`,
 * `DiceTrayView`, `DiceLogView`), sends the player's token drops, laser and rolls, shows the
 * session's status and offers Follow GM, Fit map and Reconnect. It is Connect's player view on an Atlas without the
 * remote view; it needs nothing of Atlas's map.
 */
import { SheetView } from '../../../../online-client/sheetView.mts';
import type { SheetRollRef, TokenSheet } from '../tools/sheets';
import type { PlayerPing } from '../tools/pings';
import type { MapTemplate } from '../tools/templates';
import type { PinNoteAnswer } from '../tools/pinNotes';
import { DiceLogView } from '../../../../online-client/diceLogView.mts';
import { DiceTrayView } from '../../../../online-client/diceTrayView.mts';
import { MapView } from '../../../../online-client/mapView.mts';
import type { BoardCamera, BoardExtras } from '../scene/boardTypes';
import { BoardSceneView } from './BoardSceneView';
import type { PlayerBoardFactory, PlayerDiceRequest } from './playerBoardContract';
import type { SceneViewport } from './sceneViewport';
import { PageToolbar } from '../../../../online-client/toolbar.mts';
import type { BoardDiceOffer, PlayerSessionState } from '../PlayerSession';
import { RateLimit } from '../rateLimit';
import type { SceneCamera } from '../scene/sceneCamera';
import type { PlayerScene } from '../scene/sceneTypes';
import type { DiceSelection } from '@atlas-vtt/shared/rules';
import { DICE_LIMITS, type DiceLogEntry, type PhysicalRoll, type PlayerLaser } from '../tools/toolMessages';
import type { ViewSurface } from '../view/ViewSurface';
import { createCanvasSurface } from '../view/canvasSurface';
import { createMiniLayer } from '../view/minis/miniLayer';
import type { SceneDom } from './canvasSceneDom';
import type { OnlineJoinService } from './OnlineJoinService';
import type { OnlineSceneControls, OnlineSceneSink } from './onlineJoinTypes';
import { sheetThrow } from './onlineDice';
import { rollRefusal } from './onlineRollRefusal';
import { onlineSceneStatus } from './onlineSceneStatus';

export type CanvasSceneService = Pick<OnlineJoinService, 'attach' | 'image' | 'reconnect' | 'sendDiceRoll' | 'sendTokenMove' | 'sendLaser' | 'sendSheetRoll' | 'sendPing' | 'sendTemplate'>
  & Partial<Pick<OnlineJoinService, 'sendNoteRequest' | 'model' | 'miniPainter' | 'boardPainter' | 'wantBoard' | 'images' | 'sendDiceResult'>>;

export interface CanvasSceneOptions {
  dom: SceneDom;
  service: CanvasSceneService;
  /** The session was left from elsewhere: close the tab. */
  closeTab(): void;
  /** Tests pass a recording surface, their own frames and clock; the tab uses the canvas and the browser's. */
  surface?: ViewSurface | null;
  frames?: { request(draw: () => void): number; cancel(handle: number): void };
  isHidden?: () => boolean;
  now?: () => number;
  /** Whether this tab has the keyboard: Escape in another pane must not close its tray, menus or dice log. */
  active?: () => boolean;
}

export class CanvasScene implements OnlineSceneSink {
  readonly controls: OnlineSceneControls;
  /** The view drawing the scene: the 2D map, or Tabletop's 3D board while the player shows it. */
  get map(): SceneViewport | null {
    return this.view;
  }

  private view: SceneViewport | null;
  /** Where Tabletop's board draws, over the 2D map's place; hidden while the map shows. */
  private readonly boardEl: HTMLElement;
  /** The 2D/3D button, shown only while the board can be shown. */
  private readonly dimensionButton: HTMLButtonElement;
  /** The player wants the board when it can be shown (the 2D/3D button). */
  private wantsBoard = true;
  private offered = false;
  /** The GM takes dice thrown on the board (`diceResults`), with the rules of the player's map; null when it does not. */
  private diceOffer: BoardDiceOffer | null = null;
  /** Throws on the board, at most as many a second as the GM takes rolls. */
  private readonly throwLimit = new RateLimit(DICE_LIMITS.rollsPerSecond);
  private board: BoardExtras | null = null;
  private gmBoardCamera: BoardCamera | null = null;
  private sheetEntries: readonly TokenSheet[] = [];
  private controlIds: readonly string[] = [];
  private mapCamera: SceneCamera | null = null;
  private isPaused = false;
  private sceneTemplates: { sceneId: string; list: readonly MapTemplate[] } | null = null;
  private readonly tray: DiceTrayView;
  private readonly log: DiceLogView;
  private readonly sheetView: SheetView;
  private readonly toolbar: PageToolbar;
  private readonly listeners = new AbortController();
  private state: PlayerSessionState | null = null;
  private shown: PlayerScene | null = null;
  private detachSession: (() => void) | null = null;
  private hasLog = false;
  private disposed = false;

  constructor(private readonly options: CanvasSceneOptions) {
    const { dom, service } = options;
    // The keys of the window this tab is in, which may be a popout.
    const doc = dom.root.ownerDocument;
    this.boardEl = dom.root.createDiv({ cls: 'atlas-connect-scene__board' });
    this.boardEl.hidden = true;
    dom.canvas.after(this.boardEl);
    this.view = this.makeMap();
    this.tray = new DiceTrayView({
      root: dom.diceTray,
      roll: (dice, modifier) => this.rollDice(dice, modifier),
      onClose: () => this.setDiceOpen(false),
    });

    this.log = new DiceLogView({
      panel: dom.diceLog, list: dom.diceLogList, empty: dom.diceLogEmpty, closeButton: dom.diceLogClose,
      toggleButton: dom.diceLogButton, toast: dom.diceToast,
      ...(options.active ? { active: options.active } : {}),
      doc,
    });
    this.sheetView = new SheetView({
      panel: dom.sheetPanel, body: dom.sheetBody, tabs: dom.sheetTabs, closeButton: dom.sheetClose, toggleButton: dom.sheetButton,
      onRoll: (tokenId, roll) => this.rollSheet(tokenId, roll),
      ...(options.active ? { active: options.active } : {}),
      doc,
    });
    this.toolbar = new PageToolbar({
      root: dom.toolbar,
      onTool: (tool) => this.map?.selectTool(tool),
      onShape: (shape) => this.map?.selectShape(shape),
      onTemplateShape: (shape) => this.map?.selectTemplateShape(shape),
      onClearTemplates: () => this.map?.clearOwnTemplates(),
      onLaserColor: (color) => this.map?.selectLaserColor(color),
      onLaserSize: (size) => this.map?.selectLaserSize(size),
      onDice: () => this.setDiceOpen(!this.tray.isOpen),
      ...(options.active ? { active: options.active } : {}),
      doc,
    });
    // The toolbar has drawn its controls: Follow GM and Fit map join them, shown only while the view is off the GM's.
    // With Tabletop, and a GM who can send its board: the 3D board, or the 2D map at the player's choice.
    this.dimensionButton = dom.toolbar.createEl('button', { cls: 'clickable-icon atlas-connect-scene__dimension' });
    this.dimensionButton.hidden = true;
    dom.toolbar.append(this.dimensionButton);
    dom.toolbar.append(dom.viewButtons);
    this.controls = {
      followGm: () => this.map?.followGm(),
      fitMap: () => this.map?.fitMap(),
      reconnect: () => { service.reconnect(); },
      rollDice: (dice, modifier) => (this.rollDice(dice, modifier) ? null : rollRefusal(this.state)),
    };
    const { signal } = this.listeners;
    dom.reconnect.addEventListener('click', () => this.controls.reconnect(), { signal });
    this.dimensionButton.addEventListener('click', () => {
      this.wantsBoard = !this.wantsBoard;
      this.chooseView();
    }, { signal });
    // The 2D map follows the GM by its own buttons; the 3D board's GM view is the same button.
    dom.followButton.addEventListener('click', () => { if (this.view instanceof BoardSceneView) this.view.followGm(); }, { signal });
    dom.fitButton.addEventListener('click', () => { if (this.view instanceof BoardSceneView) this.view.fitMap(); }, { signal });
    // An open tray takes Escape first, before the map returns to Move.
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.tray.isOpen || options.active?.() === false) return;
      event.stopImmediatePropagation();
      this.setDiceOpen(false);
    }, { capture: true, signal });
    this.syncToolbar();
    this.showStatus();
  }

  /** Attaches to the joined session; false when there is none. */
  attach(): boolean {
    this.detachSession = this.options.service.attach(this);
    return this.detachSession !== null;
  }

  session(state: PlayerSessionState): void {
    this.state = state;
    this.chooseView();
    // Only an admitted player drags tokens and uses the tools: reconnecting or ended cancels a gesture.
    this.map?.setConnected(state.status === 'admitted');
    // The session's order of players decides whose laser has which colour.
    this.map?.setPlayers(state.players.map((player) => player.playerId), state.playerId);
    if (state.status === 'denied' || state.status === 'lost') this.setDiceOpen(false);
    this.showStatus();
  }

  scene(scene: PlayerScene | null): void {
    this.shown = scene;
    this.map?.setScene(scene);
    this.showStatus();
    if (this.view instanceof BoardSceneView) this.syncToolbar();
  }

  camera(camera: SceneCamera): void {
    this.mapCamera = camera;
    this.map?.setGmCamera(camera);
  }

  control(tokenIds: readonly string[]): void {
    this.controlIds = tokenIds;
    this.map?.setControlled(tokenIds);
  }

  moveRefused(tokenId: string): void {
    this.map?.moveRefused(tokenId);
  }

  /** The paused banner shows over the map in the move notice, as on the join page. */
  paused(paused: boolean): void {
    this.isPaused = paused;
    this.map?.setPaused(paused);
  }

  /** The whole shared log; a roll by someone else that tops it shows as a toast while the log is closed. */
  diceLog(entries: readonly DiceLogEntry[]): void {
    const newest = entries[0];
    const live = this.hasLog && newest !== undefined && !newest.mine && newest.id !== this.log.log.entries[0]?.id;
    this.hasLog = true;
    this.log.receive(entries, true);
    if (live) this.log.log.toastRoll(newest);
  }

  /**
   * The player's own live roll, as a result card. Atlas throws a given result with its own 3D dice only in one of its
   * map views (`dice.throw`, API 1.13.0, or a remote view's `throwRoll`); this tab is Connect's own view, and a second
   * three.js would not load beside Atlas's. The remote view (`remote/RemoteSceneClient.ts`) throws them with Atlas's own dice.
   */
  ownRoll(entry: DiceLogEntry): void {
    this.log.log.toastRoll(entry);
  }

  laser(laser: PlayerLaser): void {
    if (laser.sceneId === this.shown?.sceneId) this.map?.receiveLaser(laser);
  }

  /** Every lasting template on the scene `sceneId`. */
  templates(sceneId: string, templates: readonly MapTemplate[]): void {
    this.sceneTemplates = { sceneId, list: templates };
    this.map?.receiveTemplates(sceneId, templates);
  }

  /** The GM's answer to a pin this player opened. */
  pinNote(answer: PinNoteAnswer): void {
    this.map?.receiveNote(answer);
  }

  /** Someone else's ping on the scene shown. */
  ping(ping: PlayerPing): void {
    if (ping.sceneId === this.shown?.sceneId) this.map?.receivePing(ping);
  }

  /** The sheets of the tokens this player controls: the drawer, and the Ctrl+hover preview of their stat blocks. */
  sheets(entries: readonly TokenSheet[]): void {
    this.sheetView.receive(entries);
    this.sheetEntries = entries;
    this.map?.setSheets(entries);
  }

  /** Whether the GM can send Tabletop's board of the scene, and whether it takes dice thrown on it. */
  boardOffer(available: boolean, dice?: BoardDiceOffer): void {
    this.offered = available;
    this.diceOffer = dice ?? null;
    this.chooseView();
  }

  boardExtras(extras: BoardExtras | null): void {
    this.board = extras;
    if (this.view instanceof BoardSceneView) this.view.setExtras(extras);
  }

  boardCamera(camera: BoardCamera | null): void {
    this.gmBoardCamera = camera;
    if (this.view instanceof BoardSceneView) this.view.setBoardCamera(camera);
  }

  /** Images arrived, failed or went; also when Tabletop arrived or left, which may change the view. */
  images(): void {
    this.chooseView();
    this.map?.refresh();
  }

  close(): void {
    this.options.closeTab();
  }

  resize(): void {
    this.map?.measure();
    this.toolbar.fit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachSession?.();
    this.detachSession = null;
    this.listeners.abort();
    this.log.dispose();
    this.sheetView.dispose();
    this.toolbar.dispose();
    this.map?.dispose();
  }

  /** The 2D map; null where nothing can draw it (a test without a surface). */
  private makeMap(): SceneViewport | null {
    const { dom, service, options } = { dom: this.options.dom, service: this.options.service, options: this.options };
    const doc = dom.root.ownerDocument;
    const surface = options.surface === undefined ? createCanvasSurface(dom.canvas) : options.surface;
    return surface
      ? new MapView({
        canvas: dom.canvas, surface, images: (id) => service.image(id), models: (id) => service.model?.(id) ?? null,
        // Only Obsidian draws minis, and only with the Tabletop extension, which paints them: on a bare copy of the map's
        // canvas, made by its own document (a pop-out window's too).
        minis: createMiniLayer({ painter: () => service.miniPainter?.() ?? null, canvas: () => dom.canvas.cloneNode(false) as HTMLCanvasElement }),
        viewButtons: dom.viewButtons, followButton: dom.followButton, fitButton: dom.fitButton,
        sendMove: (tokenId, x, y) => service.sendTokenMove(tokenId, x, y),
        sendLaser: (points, lifted, dt, color, size) => service.sendLaser(points, lifted, dt, color, size),
        sendPing: (x, y) => service.sendPing(x, y),
        sendTemplate: (change) => service.sendTemplate(change),
        notice: dom.moveNotice,
        hoverCard: dom.hoverCard,
        turnNotice: dom.turnNotice,
        initiative: dom.initiative,
        statblockPreview: dom.statblockPreview,
        handout: dom.handout,
        ...(service.sendNoteRequest ? { note: { ...dom.note, doc }, requestNote: (pinId: string) => service.sendNoteRequest?.(pinId) ?? false } : {}),
        onToolsChange: () => this.syncToolbar(),
        ...(options.frames ? { frames: options.frames } : {}),
        ...(options.isHidden ? { isHidden: options.isHidden } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.active ? { active: options.active } : {}),
        doc,
      })

      : null;
  }

  /** Tabletop's 3D board, drawing where the 2D map was. */
  private makeBoard(factory: PlayerBoardFactory): BoardSceneView {
    const { dom, service } = this.options;
    return new BoardSceneView({
      parent: this.boardEl,
      factory,
      image: (id) => service.image(id),
      imageUrl: (id) => service.images?.background(id) ?? null,
      model: (id) => service.model?.(id) ?? null,
      sendMove: (tokenId, x, y) => service.sendTokenMove(tokenId, x, y),
      sendLaser: (points, lifted, dt, color, size) => service.sendLaser(points, lifted, dt, color, size),
      sendPing: (x, y) => service.sendPing(x, y),
      sendTemplate: (change) => service.sendTemplate(change),
      ...(service.sendNoteRequest ? { requestNote: (pinId: string) => service.sendNoteRequest?.(pinId) ?? false } : {}),
      ...(service.sendDiceResult ? {
        sendDiceResult: (result: PhysicalRoll) => service.sendDiceResult?.(result) ?? false,
        diceRules: () => this.diceOffer?.rules ?? null,
      } : {}),
      onToolsChange: () => this.syncToolbar(),
      hoverCard: dom.hoverCard,
      statblockPreview: dom.statblockPreview,
      initiative: dom.initiative,
      turnNotice: dom.turnNotice,
      handout: dom.handout,
      note: { ...dom.note, doc: dom.root.ownerDocument },
      ...(this.options.active ? { active: this.options.active } : {}),
      doc: dom.root.ownerDocument,
    });
  }

  /**
   * The board while Tabletop offers one, the GM can send it and the player wants it; else the 2D map. A change of view
   * keeps all the session gave the tab, and asks the GM for the board (or stops asking).
   */
  private chooseView(): void {
    if (this.disposed) return;
    const factory = this.options.service.boardPainter?.() ?? null;
    const possible = factory !== null && this.offered;
    const board = possible && this.wantsBoard;
    this.dimensionButton.hidden = !possible;
    const label = board ? 'Show 2D map' : 'Show 3D board';
    this.dimensionButton.setAttribute('aria-label', label);
    this.dimensionButton.textContent = board ? '2D' : '3D';
    if (board === this.view instanceof BoardSceneView) return;
    this.view?.dispose();
    // The board's news belong to the board shown: a board shown again waits for the GM's again.
    if (!board) {
      this.board = null;
      this.gmBoardCamera = null;
    }
    const { dom } = this.options;
    this.view = board && factory ? this.makeBoard(factory) : this.makeMap();
    dom.canvas.hidden = board;
    this.boardEl.hidden = !board;
    this.options.service.wantBoard?.(board);
    this.replay();
  }

  /** What the session gave the tab, to a view just made. */
  private replay(): void {
    const view = this.view;
    if (!view) return;
    const state = this.state;
    if (state) {
      view.setConnected(state.status === 'admitted');
      view.setPlayers(state.players.map((player) => player.playerId), state.playerId);
    }
    view.setControlled(this.controlIds);
    view.setSheets(this.sheetEntries);
    view.setScene(this.shown);
    view.setPaused(this.isPaused);
    if (this.mapCamera) view.setGmCamera(this.mapCamera);
    if (this.sceneTemplates) view.receiveTemplates(this.sceneTemplates.sceneId, this.sceneTemplates.list);
    if (view instanceof BoardSceneView) {
      view.setExtras(this.board);
      view.setBoardCamera(this.gmBoardCamera);
    }
    view.measure();
    this.syncToolbar();
  }

  /** The board that throws the player's dice: the 3D board with dice, while the GM takes thrown dice; null otherwise. */
  private diceBoard(): BoardSceneView | null {
    return this.view instanceof BoardSceneView && this.diceOffer && this.view.throwsDice ? this.view : null;
  }

  /** A roll from the tray: thrown on the board where it can be, else rolled by the GM; false when it did not go. */
  private rollDice(dice: DiceSelection, modifier: number): boolean {
    return this.throwOr({ dice, modifier }, () => this.options.service.sendDiceRoll(dice, modifier));
  }

  /** A roll from the player's sheet: its dice thrown on the board where it can be, else rolled by the GM. */
  private rollSheet(tokenId: string, roll: SheetRollRef): boolean {
    const send = (): boolean => this.options.service.sendSheetRoll(tokenId, roll);
    const entry = this.diceBoard() ? this.sheetEntries.find((candidate) => candidate.tokenId === tokenId) : undefined;
    const thrown = entry ? sheetThrow(entry, roll, this.diceOffer?.rules ?? null) : null;
    return thrown ? this.throwOr({ ...thrown, sheet: { tokenId, roll } }, send) : send();
  }

  /**
   * Throws `request` on the board, refused (false) beyond the rolls a second the GM takes; the GM rolls it instead
   * (`fallback`) where there is no board to throw on, or the board cannot throw now, so no roll is lost.
   */
  private throwOr(request: PlayerDiceRequest, fallback: () => boolean): boolean {
    const board = this.diceBoard();
    if (!board) return fallback();
    if (!this.throwLimit.allow('', (this.options.now ?? Date.now)())) return false;
    return board.throwDice(request) || fallback();
  }

  private setDiceOpen(open: boolean): void {
    this.tray.setOpen(open);
    this.syncToolbar();
  }

  private syncToolbar(): void {
    // On the 3D board the GM view and Fit map are always at hand while there is a scene (the 2D map shows them only off the GM's view).
    if (this.view instanceof BoardSceneView) this.options.dom.viewButtons.hidden = this.shown === null;
    this.toolbar.update({ ...(this.map?.toolState() ?? {}), diceOpen: this.tray.isOpen });
  }

  private showStatus(): void {
    const { dom } = this.options;
    const status = onlineSceneStatus(this.state, this.shown !== null);
    dom.sessionName.setText(status.title);
    dom.connection.setText(status.connection);
    dom.connection.dataset.tone = status.tone;
    dom.message.setText(status.message ?? '');
    dom.message.hidden = status.message === null;
    dom.reconnect.hidden = !status.reconnect;
  }
}
