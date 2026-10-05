/**
 * The Canvas 2D scene tab's wiring, without the Obsidian view around it: the joined session's sink. It draws the
 * presented scene with the join page's own map, tools, dice tray and dice log (`MapView`, `PageToolbar`,
 * `DiceTrayView`, `DiceLogView`), sends the player's token drops, laser and rolls, shows the
 * session's status and offers Follow GM, Fit map and Reconnect. It is Connect's player view on an Atlas without the
 * remote view; it needs nothing of Atlas's map.
 */
import { DiceLogView } from '../../../../online-client/diceLogView.mts';
import { DiceTrayView } from '../../../../online-client/diceTrayView.mts';
import { MapView } from '../../../../online-client/mapView.mts';
import { PageToolbar } from '../../../../online-client/toolbar.mts';
import type { PlayerSessionState } from '../PlayerSession';
import type { SceneCamera } from '../scene/sceneCamera';
import type { PlayerScene } from '../scene/sceneTypes';
import type { DiceLogEntry, PlayerLaser } from '../tools/toolMessages';
import type { ViewSurface } from '../view/ViewSurface';
import { createCanvasSurface } from '../view/canvasSurface';
import type { SceneDom } from './canvasSceneDom';
import type { OnlineJoinService } from './OnlineJoinService';
import type { OnlineSceneControls, OnlineSceneSink } from './onlineJoinTypes';
import { rollRefusal } from './onlineRollRefusal';
import { onlineSceneStatus } from './onlineSceneStatus';

export type CanvasSceneService = Pick<OnlineJoinService, 'attach' | 'image' | 'reconnect' | 'sendDiceRoll' | 'sendTokenMove' | 'sendLaser'>;

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
  readonly map: MapView | null;
  private readonly tray: DiceTrayView;
  private readonly log: DiceLogView;
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
    const surface = options.surface === undefined ? createCanvasSurface(dom.canvas) : options.surface;
    this.map = surface
      ? new MapView({
        canvas: dom.canvas, surface, images: (id) => service.image(id),
        viewButtons: dom.viewButtons, followButton: dom.followButton, fitButton: dom.fitButton,
        sendMove: (tokenId, x, y) => service.sendTokenMove(tokenId, x, y),
        sendLaser: (points, lifted, dt, color) => service.sendLaser(points, lifted, dt, color),
        notice: dom.moveNotice,
        onToolsChange: () => this.syncToolbar(),
        ...(options.frames ? { frames: options.frames } : {}),
        ...(options.isHidden ? { isHidden: options.isHidden } : {}),
        ...(options.now ? { now: options.now } : {}),
        ...(options.active ? { active: options.active } : {}),
        doc,
      })
      : null;
    this.tray = new DiceTrayView({
      root: dom.diceTray,
      roll: (dice, modifier) => service.sendDiceRoll(dice, modifier),
      onClose: () => this.setDiceOpen(false),
    });
    this.log = new DiceLogView({
      panel: dom.diceLog, list: dom.diceLogList, empty: dom.diceLogEmpty, closeButton: dom.diceLogClose,
      toggleButton: dom.diceLogButton, toast: dom.diceToast,
      ...(options.active ? { active: options.active } : {}),
      doc,
    });
    this.toolbar = new PageToolbar({
      root: dom.toolbar,
      onTool: (tool) => this.map?.selectTool(tool),
      onShape: (shape) => this.map?.selectShape(shape),
      onLaserColor: (color) => this.map?.selectLaserColor(color),
      onDice: () => this.setDiceOpen(!this.tray.isOpen),
      ...(options.active ? { active: options.active } : {}),
      doc,
    });
    this.controls = {
      followGm: () => this.map?.followGm(),
      fitMap: () => this.map?.fitMap(),
      reconnect: () => { service.reconnect(); },
      rollDice: (dice, modifier) => (service.sendDiceRoll(dice, modifier) ? null : rollRefusal(this.state)),
    };
    const { signal } = this.listeners;
    dom.reconnect.addEventListener('click', () => this.controls.reconnect(), { signal });
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
  }

  camera(camera: SceneCamera): void {
    this.map?.setGmCamera(camera);
  }

  control(tokenIds: readonly string[]): void {
    this.map?.setControlled(tokenIds);
  }

  moveRefused(tokenId: string): void {
    this.map?.moveRefused(tokenId);
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

  /** Images arrived, failed or went. */
  images(): void {
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
    this.toolbar.dispose();
    this.map?.dispose();
  }

  private setDiceOpen(open: boolean): void {
    this.tray.setOpen(open);
    this.syncToolbar();
  }

  private syncToolbar(): void {
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
