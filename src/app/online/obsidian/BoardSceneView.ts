/**
 * The player tab's 3D view: Tabletop's player board (`playerBoardContract.ts`) draws the scene and takes the pointer;
 * this keeps what lies around the map as the 2D view has it (the hover card, Ctrl+hover stat block, readable pins'
 * notes, the handout, the initiative column, "Your turn") and passes the player's moves, pings, lasers and templates
 * to the session. The board extras and the GM's 3D camera come from `CanvasScene`.
 */
import { HandoutView, type HandoutViewOptions } from '../../../../online-client/handoutView.mts';
import { HoverCardView } from '../../../../online-client/hoverCardView.mts';
import { InitiativeView } from '../../../../online-client/initiativeView.mts';
import { NOTE_WAIT_MS, type ToolState } from '../../../../online-client/mapView.mts';
import { NoteView, type NoteViewOptions } from '../../../../online-client/noteView.mts';
import { StatblockPreviewView } from '../../../../online-client/statblockPreviewView.mts';
import type { DecodedImage } from '../assets/AssetLoader';
import type { BoardCamera, BoardExtras } from '../scene/boardTypes';
import type { SceneCamera } from '../scene/sceneCamera';
import type { PlayerScene, ScenePoint } from '../scene/sceneTypes';
import type { PinNoteAnswer } from '../tools/pinNotes';
import type { PlayerPing } from '../tools/pings';
import type { TokenSheet } from '../tools/sheets';
import type { MapTemplate, TemplateShape } from '../tools/templates';
import type { OfferedDiceRules, PhysicalRoll, PlayerLaser } from '../tools/toolMessages';
import { conditionRows } from '../view/tokenHover';
import type { MeasureChoice } from '../view/tools/MeasureTool';
import type { PlayerTool, TemplateChange } from '../view/tools/PlayerTools';
import { nextTurnOf, turnNotice, turnOf } from '../view/turns';
import type { PlayerBoardFactory, PlayerBoardHandle, PlayerDiceRequest } from './playerBoardContract';
import type { SceneViewport } from './sceneViewport';

export interface BoardSceneViewOptions {
  /** Where the board draws: the element over the 2D map's place. */
  parent: HTMLElement;
  factory: PlayerBoardFactory;
  /** An image as decoded (the handout, initiative portraits) and as a URL the board loads; a model's bytes. */
  image(id: string | null): DecodedImage | null;
  imageUrl(id: string): string | null;
  model(id: string): ArrayBuffer | null;
  sendMove(tokenId: string, x: number, y: number): boolean;
  sendLaser(points: ScenePoint[], lifted: boolean, dt: number[], color?: string, size?: number): boolean;
  sendPing(x: number, y: number): boolean;
  sendTemplate(change: TemplateChange): boolean;
  requestNote?(pinId: string): boolean;
  /** Sends dice thrown on the board to the GM; without it the board has no dice. */
  sendDiceResult?(result: PhysicalRoll): boolean;
  /** The dice rules of the player's map, as the GM offered them; null for the default. */
  diceRules?(): OfferedDiceRules | null;
  onToolsChange(): void;
  hoverCard: HTMLElement;
  statblockPreview: HTMLElement;
  initiative: HTMLElement;
  turnNotice: HTMLElement;
  handout: HandoutViewOptions;
  note: NoteViewOptions;
  active?: () => boolean;
  doc?: Document;
}

export class BoardSceneView implements SceneViewport {
  private readonly board: PlayerBoardHandle;
  private readonly hoverCard: HoverCardView;
  private readonly preview: StatblockPreviewView;
  private readonly initiative: InitiativeView;
  private readonly handout: HandoutView;
  private readonly note: NoteView | null;
  private scene: PlayerScene | null = null;
  private controlled: readonly string[] = [];
  private sheets = new Map<string, TokenSheet>();
  private awaitedNote: { sceneId: string; pinId: string; timer: number } | null = null;
  private laserSize = 16;

  constructor(private readonly options: BoardSceneViewOptions) {
    const extra = { ...(options.active ? { active: options.active } : {}), ...(options.doc ? { doc: options.doc } : {}) };
    this.hoverCard = new HoverCardView(options.hoverCard);
    this.preview = new StatblockPreviewView(options.statblockPreview);
    this.initiative = new InitiativeView({ panel: options.initiative, images: (id) => options.image(id) });
    this.handout = new HandoutView({ ...options.handout, ...(options.active ? { active: options.active } : {}) });
    this.note = options.requestNote ? new NoteView({ ...options.note, ...extra }) : null;
    this.board = options.factory.create(options.parent, {
      image: (id) => options.imageUrl(id),
      model: (id) => options.model(id),
      sendMove: (tokenId, x, y) => options.sendMove(tokenId, x, y),
      // Tabletop's board knows no size: the one picked in the Move menu goes with each stroke.
      sendLaser: (points, lifted, dt, color) => options.sendLaser(points, lifted, dt, color, this.laserSize),
      sendPing: (x, y) => options.sendPing(x, y),
      sendTemplate: (change) => options.sendTemplate(change),
      openPin: (pinId) => this.openPin(pinId),
      hover: (tokenId, client, modifier) => this.hover(tokenId, client, modifier),
      toolsChanged: () => options.onToolsChange(),
      ...(options.sendDiceResult ? {
        sendDiceResult: (result: PhysicalRoll) => options.sendDiceResult?.(result) ?? false,
        diceRules: () => options.diceRules?.() ?? null,
      } : {}),
    });
  }

  setScene(scene: PlayerScene | null): void {
    this.scene = scene;
    this.board.setScene(scene);
    this.initiative.update(scene);
    this.updateHandout();
    this.updateTurn();
  }

  /** Tabletop's board of the scene: walls, doors, lights, props and materials. */
  setExtras(extras: BoardExtras | null): void {
    this.board.setExtras(extras);
  }

  /** The GM's 3D view, for the GM view button. */
  setBoardCamera(camera: BoardCamera | null): void {
    this.board.setGmCamera(camera);
  }

  setSheets(entries: readonly TokenSheet[]): void {
    this.sheets = new Map(entries.map((entry) => [entry.tokenId, entry]));
  }

  setGmCamera(camera: SceneCamera | null): void {
    this.board.setGmMapCamera(camera);
  }

  setControlled(tokenIds: readonly string[]): void {
    this.controlled = tokenIds;
    this.board.setControlled(tokenIds);
    this.updateTurn();
  }

  setConnected(connected: boolean): void { this.board.setConnected(connected); }
  moveRefused(tokenId: string): void { this.board.moveRefused(tokenId); }
  setPaused(paused: boolean): void { this.board.setPaused(paused); }
  selectTool(tool: PlayerTool): void { this.board.selectTool(tool); }
  followGm(): void { this.board.followGm(); }
  fitMap(): void { this.board.fitMap(); }
  selectTemplateShape(shape: TemplateShape): void { this.board.selectTemplateShape(shape); }
  clearOwnTemplates(): void { this.board.clearOwnTemplates(); }
  selectShape(shape: MeasureChoice): void { this.board.selectShape(shape); }
  selectLaserColor(color: string): void { this.board.selectLaserColor(color); }

  /** The laser's size: Tabletop's board draws its own lasers at one width, but the size goes to everyone else. */
  selectLaserSize(size: number): void {
    if (!Number.isFinite(size)) return;
    this.laserSize = Math.round(Math.min(100, Math.max(8, size)));
    // Choosing the tool in use again would return to Move.
    if (this.board.toolState().tool !== 'laser') this.board.selectTool('laser');
    this.options.onToolsChange();
  }
  setPlayers(order: readonly string[], self: string | null): void { this.board.setPlayers(order, self); }
  receiveTemplates(sceneId: string, templates: readonly MapTemplate[]): void { this.board.receiveTemplates(sceneId, templates); }
  receivePing(ping: PlayerPing): void { this.board.receivePing(ping); }
  receiveLaser(laser: PlayerLaser): void { this.board.receiveLaser(laser); }
  measure(): void { this.board.measure(); }

  toolState(): ToolState {
    const { tool, shape, templateShape, ownTemplates, laserColor } = this.board.toolState();
    return { tool, shape, templateShape: templateShape as TemplateShape, ownTemplates, laserColor, laserSize: this.laserSize };
  }

  /** Whether the board throws dice (an older Tabletop's has none). */
  get throwsDice(): boolean {
    return this.board.diceAvailable === true && typeof this.board.throwDice === 'function';
  }

  /** Throws the roll on the board; false when it cannot now (no dice, no scene). */
  throwDice(request: PlayerDiceRequest): boolean {
    return this.throwsDice && this.board.throwDice?.(request) === true;
  }

  receiveNote(answer: PinNoteAnswer): void {
    const awaited = this.awaitedNote;
    if (!awaited || awaited.sceneId !== answer.sceneId || awaited.pinId !== answer.pinId) return;
    this.stopAwaitingNote();
    this.note?.show(answer.note);
  }

  refresh(): void {
    this.board.refresh();
    this.updateHandout();
    this.initiative.update(this.scene, true);
  }

  dispose(): void {
    this.stopAwaitingNote();
    this.hoverCard.hide();
    this.preview.hide();
    this.note?.dispose();
    this.handout.dispose();
    this.board.dispose();
  }

  /** Opens a readable pin's note: loading until the GM answers, unavailable if it never does. */
  private openPin(pinId: string): void {
    const scene = this.scene;
    if (!scene || !this.note || !this.options.requestNote?.(pinId)) return;
    this.stopAwaitingNote();
    const win = this.options.parent.ownerDocument.defaultView ?? window;
    const awaited = { sceneId: scene.sceneId, pinId, timer: 0 };
    awaited.timer = win.setTimeout(() => {
      if (this.awaitedNote !== awaited) return;
      this.awaitedNote = null;
      this.note?.show(null);
    }, NOTE_WAIT_MS);
    this.awaitedNote = awaited;
    const pin = scene.pins?.find((entry) => entry.id === pinId);
    this.note.loading(pin?.title ?? 'Note');
  }

  private stopAwaitingNote(): void {
    if (this.awaitedNote) (this.options.parent.ownerDocument.defaultView ?? window).clearTimeout(this.awaitedNote.timer);
    this.awaitedNote = null;
  }

  /** The token under the pointer: its conditions card, or with Ctrl or Cmd its stat block when it is the player's. */
  private hover(tokenId: string | null, client: { x: number; y: number } | null, modifier: boolean): void {
    const scene = this.scene;
    const sheet = tokenId && modifier ? this.sheets.get(tokenId) : undefined;
    if (sheet && client) this.preview.show(sheet, client.x, client.y);
    else this.preview.hide();
    if (!scene || !client || !tokenId || modifier || !scene.tokens[tokenId]) {
      this.hoverCard.hide();
      return;
    }
    this.hoverCard.showConditions(conditionRows(scene, tokenId), client.x, client.y);
  }

  private updateHandout(): void {
    const handout = this.scene?.handout ?? null;
    this.handout.update(handout, handout?.asset ? this.options.image(handout.asset) : null);
  }

  private updateTurn(): void {
    const controlled = new Set(this.controlled);
    const text = turnNotice(turnOf(this.scene, controlled), nextTurnOf(this.scene, controlled));
    this.options.turnNotice.textContent = text ?? '';
    this.options.turnNotice.hidden = text === null;
  }
}
