// online-client/mapView.mts
/**
 * The map on the join page. It binds the canvas and its input, the Follow GM and Fit map
 * buttons, resizing and page visibility. It also binds the player's token moves (cursor, Escape,
 * the "Move not allowed." notice) and tools: Move, Measure, Laser, and the drag ruler's
 * waypoint key. The decisions live in the tested shared modules: `CameraController`,
 * `ViewInput`, `PlayerViewRenderer`, `TokenMoves` and `PlayerTools`. Only the canvas takes map
 * input, so a gesture that starts on the top bar, the menu, the toolbar or a button never moves
 * the map.
 */
import type { SceneCamera } from '../src/app/online/scene/sceneCamera';
import type { PlayerScene, ScenePoint } from '../src/app/online/scene/sceneTypes';
import type { PlayerLaser } from '../src/app/online/tools/toolMessages';
import type { PlayerPing } from '../src/app/online/tools/pings';
import type { MapTemplate, TemplateShape } from '../src/app/online/tools/templates';
import type { ScreenPoint } from '../src/app/online/view/camera';
import { CameraController } from '../src/app/online/view/CameraController';
import type { ImageLookup, ModelLookup } from '../src/app/online/view/layers/layerTypes';
import { createSceneLayers } from '../src/app/online/view/layers/sceneLayers';
import type { MiniLayer } from '../src/app/online/view/minis/miniLayer';
import { pixelRatioFor, PlayerViewRenderer } from '../src/app/online/view/PlayerViewRenderer';
import { TokenMoves } from '../src/app/online/view/TokenMoves';
import type { MeasureChoice } from '../src/app/online/view/tools/MeasureTool';
import { PlayerTools, type PlayerTool, type TemplateChange } from '../src/app/online/view/tools/PlayerTools';
import { createToolsLayer } from '../src/app/online/view/tools/toolsLayer';
import { ViewInput } from '../src/app/online/view/ViewInput';
import type { ViewSurface } from '../src/app/online/view/ViewSurface';
import { whenTokenRingLoaded } from '../src/app/online/view/canvasSurface';
import { bindMapInput } from './mapInput.mts';
import { HoverCardView } from './hoverCardView.mts';
import { HandoutView, type HandoutViewOptions } from './handoutView.mts';
import { NoteView, type NoteViewOptions } from './noteView.mts';
import type { PinNoteAnswer } from '../src/app/online/tools/pinNotes';
import { InitiativeView } from './initiativeView.mts';
import { StatblockPreviewView } from './statblockPreviewView.mts';
import type { TokenSheet } from '../src/app/online/tools/sheets';
import { conditionRows, tokenAt } from '../src/app/online/view/tokenHover';
import type { TokenOverlay } from '../src/app/online/view/layers/layerTypes';
import { computeTokenPixelSize, computeTokenStrokeWidth, getTokenRingCenterRadius } from '@atlas-vtt/shared/draw';

import { nextTurnOf, turnNotice, turnOf } from '../src/app/online/view/turns';
import { createPinsLayer, pinAt } from '../src/app/online/view/layers/pinsLayer';

/** A press that moves further than this, in CSS pixels, pans or drags instead of selecting. */
const CLICK_TOLERANCE = 5;

/** What the toolbar shows of the tools. */
export interface ToolState {
  tool: PlayerTool;
  shape: MeasureChoice;
  templateShape: TemplateShape;
  /** Whether this player has a template on the scene. */
  ownTemplates: boolean;
  laserColor: string;
  laserSize: number;
}

export interface MapViewOptions {
  canvas: HTMLCanvasElement;
  surface: ViewSurface;
  images: ImageLookup;
  /** The minis' models (GLB bytes) and the layer that draws them; the web page has neither, so no mini is drawn there. */
  models?: ModelLookup;
  minis?: MiniLayer;
  /** Holds Follow GM and Fit map, shown while the player has broken away. */
  viewButtons: HTMLElement;
  followButton: HTMLButtonElement;
  fitButton: HTMLButtonElement;
  /** Sends one drop of a controlled token; false when it could not be sent. */
  sendMove(tokenId: string, x: number, y: number): boolean;
  /** Sends new points of the player's laser; false when they could not be sent. */
  sendLaser(points: ScenePoint[], lifted: boolean, dt: number[], color?: string, size?: number): boolean;
  /** Sends a ping at a world point; false when it could not go. */
  sendPing?(x: number, y: number): boolean;
  /** Asks the GM to add or remove a template; false when it could not go. */
  sendTemplate?(change: TemplateChange): boolean;
  /** The laser colour remembered from an earlier visit. */
  laserColor?: string | null;
  /** The player picked a laser colour: remember it. */
  onLaserColor?(color: string): void;
  /** The laser size remembered from an earlier visit, and remembering a new one. */
  laserSize?: number | null;
  onLaserSize?(size: number): void;
  /** Shows "Move not allowed." after a refused move. */
  notice: HTMLElement;
  /** The tool or measure shape changed, also by Escape: the toolbar follows. */
  onToolsChange?(): void;
  /** Tests pass their own; the page uses the browser's animation frames, visibility and clock. */
  frames?: { request(draw: () => void): number; cancel(handle: number): void };
  isHidden?: () => boolean;
  now?: () => number;
  /** Whether this map's surface has the keyboard; the page always does (Obsidian passes whether its tab is active). */
  active?: () => boolean;
  /** The document whose keys the map takes; the page's by default. */
  doc?: Document;
  /** The panel of the image the GM shows players; without it handouts are not shown. */
  handout?: HandoutViewOptions;
  /** Says "Your turn" while a token the player controls has the turn; without it nothing says so. */
  turnNotice?: HTMLElement;
  /** The card shown while the mouse rests on a token (its name, conditions and, for the player's own, numbers); without it none shows. */
  hoverCard?: HTMLElement;
  /** The initiative column (`InitiativeView`); without it the fight's order is not shown on the map. */
  initiative?: HTMLElement;
  /** Atlas's Ctrl/Cmd+hover stat block preview of the player's tokens (`StatblockPreviewView`); without it none shows. */
  statblockPreview?: HTMLElement;
  /** The drawer of a readable pin's note (`NoteView`); without it, or without `requestNote`, clicking a pin opens nothing. */
  note?: NoteViewOptions;
  /** Asks the GM for the note of a pin of the scene shown; false when it cannot go. */
  requestNote?: (pinId: string) => boolean;
}

/** How long the GM is waited for before a note is said to be unavailable (an older Connect never answers). */
export const NOTE_WAIT_MS = 10_000;

export class MapView {
  private readonly camera: CameraController;
  private readonly renderer: PlayerViewRenderer;
  private readonly moves: TokenMoves;
  private readonly tools: PlayerTools;
  private readonly input: ViewInput;
  private hasScene = false;
  private scene: PlayerScene | null = null;
  private readonly hoverCard: HoverCardView | null;
  private readonly handout: HandoutView | null;
  private readonly note: NoteView | null;
  /** The pin whose note is on its way, and the timer that gives up on it. */
  private awaitedNote: { sceneId: string; pinId: string; timer: number } | null = null;
  private readonly initiative: InitiativeView | null;
  private readonly preview: StatblockPreviewView | null;
  /** The player's sheets by token (`token-sheets`): what the Ctrl+hover preview shows. */
  private sheets = new Map<string, TokenSheet>();
  /** Where the mouse is over the canvas, for the grab cursor; null when it is elsewhere. */
  private hover: ScreenPoint | null = null;
  /** The token the player selected with a click (Atlas's selection): its UI grows and shows its numbers. */
  private selected: string | null = null;
  /** The token under the pointer: its numbers show, and its conditions card. */
  private hovered: string | null = null;
  /** Ctrl or Cmd is down: Atlas then shows a token's stat block instead of its conditions card. */
  private modifier = false;
  /** Where the last press began, so a click that dragged (a pan) does not select. */
  private pressedAt: { x: number; y: number } | null = null;
  /** What the toolbar was last told. */
  private shownTool: ToolState = { tool: 'move', shape: 'line', templateShape: 'circle', ownTemplates: false, laserColor: '', laserSize: 16 };
  private readonly listeners = new AbortController();
  private resizeObserver: ResizeObserver | null = null;
  private watchedRatio: number | null = null;
  private unwatchRatio: (() => void) | null = null;

  constructor(private readonly options: MapViewOptions) {
    const frames = options.frames ?? {
      request: (draw: () => void): number => window.requestAnimationFrame(() => draw()),
      cancel: (handle: number): void => window.cancelAnimationFrame(handle),
    };
    this.camera = new CameraController({ now: () => performance.now(), onChange: () => this.cameraChanged() });
    this.renderer = new PlayerViewRenderer({
      surface: options.surface,
      camera: this.camera,
      images: options.images,
      ...(options.models ? { models: options.models } : {}),
      layers: createSceneLayers(options.minis ? { minis: options.minis } : {}),
      // Read at draw time, once the tools exist.
      overlays: [createPinsLayer(), createToolsLayer({ overlay: () => this.tools.overlay(), isAnimating: () => this.tools.isAnimating() })],
      requestFrame: (draw) => frames.request(draw),
      cancelFrame: (handle) => frames.cancel(handle),
      isHidden: options.isHidden ?? ((): boolean => document.hidden),
      isDark: () => this.isDark(),
    });
    this.watchTheme();
    this.moves = new TokenMoves({
      toWorld: (point) => this.camera.toWorld(point),
      send: (tokenId, x, y) => options.sendMove(tokenId, x, y),
      onChange: () => this.movesChanged(),
    });
    this.tools = new PlayerTools({
      moves: this.moves,
      toWorld: (point) => this.camera.toWorld(point),
      zoom: () => this.camera.current().zoom,
      now: options.now ?? ((): number => performance.now()),
      sendLaser: (points, lifted, dt, color, size) => options.sendLaser(points, lifted, dt, color, size),
      sendPing: (x, y) => options.sendPing?.(x, y) ?? false,
      sendTemplate: (change) => options.sendTemplate?.(change) ?? false,
      laserColor: options.laserColor ?? null,
      laserSize: options.laserSize ?? null,
      onChange: () => this.toolsChanged(),
    });
    this.input = new ViewInput(this.camera, this.tools);
    this.hoverCard = options.hoverCard ? new HoverCardView(options.hoverCard) : null;
    this.handout = options.handout ? new HandoutView({ ...options.handout, ...(options.active ? { active: options.active } : {}) }) : null;
    this.note = options.note && options.requestNote
      ? new NoteView({ ...options.note, ...(options.active ? { active: options.active } : {}), ...(options.doc ? { doc: options.doc } : {}) })
      : null;
    this.initiative = options.initiative ? new InitiativeView({ panel: options.initiative, images: options.images }) : null;
    this.preview = options.statblockPreview ? new StatblockPreviewView(options.statblockPreview) : null;
    options.canvas.dataset.tool = this.shownTool.tool;
    this.bind();
    this.measure();
    // Tokens are drawn with Atlas's stand-in ring until the ring texture has loaded: then once more with it.
    const stopRing = whenTokenRingLoaded(() => {
      this.renderer.invalidate();
      this.initiative?.update(this.scene, true);
    });
    this.listeners.signal.addEventListener('abort', stopRing, { once: true });
  }

  /** The scene to show; null shows nothing and resets the camera. */
  setScene(scene: PlayerScene | null): void {
    // Another scene: the frame players saw fades into it, as Atlas's player window crossfades (`crossfadeToNextMap`).
    if (this.scene && scene && this.scene.sceneId !== scene.sceneId) this.crossfade();
    this.hasScene = scene !== null;
    this.scene = scene;
    this.camera.setScene(scene);
    this.renderer.setScene(scene);
    this.moves.setScene(scene);
    this.tools.setScene(scene);
    this.updateButtons();
    this.updateHoverCard();
    this.updateTurn();
    this.updateHandout();
    this.initiative?.update(scene);
  }

  /** The sheets of the tokens this player controls (`token-sheets`): Ctrl+hover over one shows its stat block. */
  setSheets(entries: readonly TokenSheet[]): void {
    this.sheets = new Map(entries.map((entry) => [entry.tokenId, entry]));
    this.updateHoverCard();
  }

  setGmCamera(camera: SceneCamera | null): void {
    this.camera.setGmCamera(camera);
  }

  /** The tokens this player controls, from the GM's latest list. */
  setControlled(tokenIds: readonly string[]): void {
    this.moves.setControlled(tokenIds);
  }

  /** Whether the player is admitted: only then can tokens be dragged and tools send. */
  setConnected(connected: boolean): void {
    this.moves.setConnected(connected);
    this.tools.setConnected(connected);
  }

  /** The GM refused a move of this token. */
  moveRefused(tokenId: string): void {
    this.moves.refused(tokenId);
  }

  /** The scene is paused (the GM is on another scene) or live again: the move notice shows the paused banner while paused. */
  setPaused(paused: boolean): void {
    this.moves.setPaused(paused);
  }

  /** Chooses a tool; the active one again returns to Move. */
  selectTool(tool: PlayerTool): void {
    this.tools.select(tool);
  }

  /** The camera follows the GM's again (the Follow GM button). */
  followGm(): void {
    this.camera.followGm();
  }

  /** The camera fits the whole map (the Fit map button). */
  fitMap(): void {
    this.camera.fitMap();
  }

  /** A shape from the Template tool's menu, and the Template tool with it. */
  selectTemplateShape(shape: TemplateShape): void {
    this.tools.selectTemplateShape(shape);
  }

  /** Takes all of this player's templates off the scene. */
  clearOwnTemplates(): void {
    this.tools.clearOwnTemplates();
  }

  selectShape(shape: MeasureChoice): void {
    this.tools.selectShape(shape);
  }

  selectLaserColor(color: string): void {
    if (this.tools.selectLaserColor(color)) this.options.onLaserColor?.(this.tools.laserColor);
  }

  selectLaserSize(size: number): void {
    this.tools.selectLaserSize(size);
    this.options.onLaserSize?.(this.tools.laserSize);
  }

  toolState(): ToolState {
    return {
      tool: this.tools.tool, shape: this.tools.shape, templateShape: this.tools.templateShape,
      ownTemplates: this.tools.hasOwnTemplates(), laserColor: this.tools.laserColor, laserSize: this.tools.laserSize,
    };
  }

  /** The session's players in order and this player's id: whose laser has which colour. */
  setPlayers(order: readonly string[], self: string | null): void {
    this.tools.setPlayers(order, self);
    // The laser colour follows a player's place until they pick one.
    this.toolsChanged();
  }

  /** Every lasting template on the scene `sceneId`. */
  /** The GM's answer to a pin the player opened; one for a pin no longer awaited (another opened since) is dropped. */
  receiveNote(answer: PinNoteAnswer): void {
    const awaited = this.awaitedNote;
    if (!awaited || awaited.sceneId !== answer.sceneId || awaited.pinId !== answer.pinId) return;
    this.stopAwaitingNote();
    this.note?.show(answer.note);
  }

  receiveTemplates(sceneId: string, templates: readonly MapTemplate[]): void {
    this.tools.receiveTemplates(sceneId, templates);
    // Clear my templates is offered only while the player has some.
    this.toolsChanged();
  }

  /** Someone else's ping. */
  receivePing(ping: PlayerPing): void {
    this.tools.receivePing(ping);
  }

  receiveLaser(laser: PlayerLaser): void {
    this.tools.receiveLaser(laser);
  }

  /** Images arrived or went. */
  refresh(): void {
    this.renderer.invalidate();
    this.updateHandout();
    this.initiative?.update(this.scene, true);
  }

  private updateHandout(): void {
    const handout = this.scene?.handout ?? null;
    this.handout?.update(handout, handout?.asset ? this.options.images(handout.asset) : null);
  }

  /** The session is over: stops drawing and frees the fog image. The page does not use the view again. */
  dispose(): void {
    this.transition?.cancel();
    this.listeners.abort();
    this.handout?.dispose();
    this.stopAwaitingNote();
    this.note?.dispose();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.unwatchPixelRatio();
    this.tools.dispose();
    this.moves.dispose();
    this.renderer.dispose();
  }

  /** Reads the canvas's size again, e.g. once the table is shown. */
  measure(): void {
    const { clientWidth: width, clientHeight: height } = this.options.canvas;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.camera.setScreen({ width, height });
    this.renderer.setSize({ width, height }, pixelRatioFor(window.devicePixelRatio, coarse));
    this.watchPixelRatio();
  }

  /**
   * Whether the page is dark, as Atlas reads it: Obsidian's theme class on the body, or without one (the join page)
   * the system's scheme, which the page's own colours follow.
   */
  private isDark(): boolean {
    const doc = this.options.doc ?? document;
    const body = doc.body;
    if (body?.classList.contains('theme-dark')) return true;
    if (body?.classList.contains('theme-light')) return false;
    const view = doc.defaultView;
    return typeof view?.matchMedia === 'function' ? view.matchMedia('(prefers-color-scheme: dark)').matches : true;
  }

  /** Draws again when the theme changes: Obsidian swaps the body's class, the system its scheme. */
  private watchTheme(): void {
    const doc = this.options.doc ?? document;
    const view = doc.defaultView;
    const { signal } = this.listeners;
    if (typeof view?.matchMedia === 'function') {
      view.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.renderer.invalidate(), { signal });
    }
    if (doc.body && typeof view?.MutationObserver === 'function') {
      const observer = new view.MutationObserver(() => this.renderer.invalidate());
      observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
      signal.addEventListener('abort', () => observer.disconnect(), { once: true });
    }
  }

  /** The frame of the scene before, fading out over the next; null once it has. */
  private transition: { paintInto(context: CanvasRenderingContext2D): void; cancel(): void } | null = null;

  /**
   * Atlas's `freezeCanvasFrame` without the settle, as its player window plays it: a still copy of the map's current
   * frame, laid right over it, fades out over 300 ms while the next scene draws beneath. A fade still playing is carried
   * over at its opacity.
   */
  private crossfade(): void {
    const canvas = this.options.canvas;
    if (canvas.width === 0 || canvas.height === 0) return;
    const snapshot = canvas.ownerDocument.createElement('canvas');
    snapshot.className = 'scene-transition-snapshot';
    snapshot.setAttribute('aria-hidden', 'true');
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = snapshot.getContext('2d');
    } catch {
      context = null;
    }
    if (!context || typeof snapshot.animate !== 'function') return;
    context.drawImage(canvas, 0, 0);
    this.transition?.paintInto(context);
    this.transition?.cancel();
    canvas.after(snapshot);
    const fade = snapshot.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' });
    const transition = {
      paintInto: (into: CanvasRenderingContext2D): void => {
        if (!snapshot.isConnected) return;
        into.globalAlpha = Number(snapshot.ownerDocument.defaultView?.getComputedStyle(snapshot).opacity ?? 1);
        into.drawImage(snapshot, 0, 0);
        into.globalAlpha = 1;
      },
      cancel: (): void => {
        fade.cancel();
        snapshot.remove();
        // Its pixels go at once rather than with the garbage.
        snapshot.width = 0;
        snapshot.height = 0;
        if (this.transition === transition) this.transition = null;
      },
    };
    fade.onfinish = transition.cancel;
    this.transition = transition;
  }

  /** The ratio changes without a resize when the window moves to another screen or the page is zoomed. */
  private watchPixelRatio(): void {
    if (this.listeners.signal.aborted || typeof window.matchMedia !== 'function') return;
    // measure() runs on every resize: arm a listener only when the ratio changed, and drop the old one.
    if (this.watchedRatio === window.devicePixelRatio) return;
    this.unwatchPixelRatio();
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const onChange = (): void => {
      // The listener fired once and is gone: measure() arms the next one.
      this.unwatchPixelRatio();
      this.measure();
    };
    query.addEventListener('change', onChange, { once: true });
    this.watchedRatio = window.devicePixelRatio;
    this.unwatchRatio = () => query.removeEventListener('change', onChange);
  }

  private unwatchPixelRatio(): void {
    this.unwatchRatio?.();
    this.unwatchRatio = null;
    this.watchedRatio = null;
  }

  private cameraChanged(): void {
    this.renderer.invalidate();
    this.updateButtons();
  }

  /** The token overlay the map draws with: the moves', and what the player selected and points at. */
  private tokenOverlay(): TokenOverlay {
    return { ...this.moves.overlay(), selected: this.selected, hovered: this.hovered };
  }

  private movesChanged(): void {
    this.renderer.setOverlay(this.tokenOverlay());
    const notice = this.moves.notice();
    this.options.notice.textContent = notice ?? '';
    this.options.notice.hidden = notice === null;
    this.updateCursor();
    this.updateHoverCard();
    this.updateTurn();
  }

  /** Draws again; the toolbar hears only of a new tool or shape, never of every move. */
  private toolsChanged(): void {
    this.renderer.invalidate();
    const state = this.toolState();
    const shown = this.shownTool;
    if (state.tool === shown.tool && state.shape === shown.shape && state.templateShape === shown.templateShape
      && state.ownTemplates === shown.ownTemplates && state.laserColor === shown.laserColor && state.laserSize === shown.laserSize) return;
    this.shownTool = state;
    const { tool } = state;
    this.options.canvas.dataset.tool = tool;
    this.updateCursor();
    this.options.onToolsChange?.();
  }

  /** A grab hand over the player's tokens with Move; grabbing while one is held. */
  private updateCursor(): void {
    const { canvas } = this.options;
    const holding = this.moves.isDragging();
    canvas.classList.toggle('is-grabbing', holding);
    const canGrab = !holding && this.tools.tool === 'move' && this.hover !== null && this.moves.canGrab(this.hover);
    canvas.classList.toggle('can-grab', canGrab);
  }

  /** "Your turn" while a token the player controls (or its side) has the turn, "Your turn is next" on the turn before. */
  private updateTurn(): void {
    const element = this.options.turnNotice;
    if (!element) return;
    const { controlled } = this.moves.overlay();
    const text = turnNotice(turnOf(this.scene, controlled), nextTurnOf(this.scene, controlled));
    element.textContent = text ?? '';
    element.hidden = text === null;
  }

  /**
   * The token under the pointer, and what it shows: Atlas's conditions card beside it on a plain hover (not while it is
   * selected or held, nor with Ctrl or Cmd down); a readable pin's title by the pointer when no token is there.
   */
  private updateHoverCard(): void {
    const scene = this.scene;
    const hovered = scene && this.hover && !this.moves.isDragging()
      ? tokenAt(scene, this.moves.overlay().positions, this.camera.toWorld(this.hover))
      : null;
    if (hovered !== this.hovered) {
      this.hovered = hovered;
      this.renderer.setOverlay(this.tokenOverlay());
    }
    const rect = this.options.canvas.getBoundingClientRect();
    // Ctrl or Cmd over one of the player's tokens: its stat block by the pointer, as Atlas previews one.
    const sheet = hovered && this.modifier && this.hover ? this.sheets.get(hovered) : undefined;
    if (sheet && this.hover) this.preview?.show(sheet, rect.left + this.hover.x, rect.top + this.hover.y);
    else this.preview?.hide();
    const card = this.hoverCard;
    if (!card) return;
    if (!scene || !this.hover || this.moves.isDragging()) {
      card.hide();
      return;
    }
    if (hovered) {
      const token = scene.tokens[hovered];
      if (!token || this.modifier || hovered === this.selected) {
        card.hide();
        return;
      }
      const at = this.moves.overlay().positions.get(hovered) ?? token;
      const cellSize = scene.map.cellSize;
      const size = Math.max(1, computeTokenPixelSize(cellSize, token.size));
      const ring = getTokenRingCenterRadius(size, computeTokenStrokeWidth(cellSize), 1) + computeTokenStrokeWidth(cellSize) / 2;
      const screen = this.camera.toScreen({ x: at.x + ring, y: at.y });
      card.showConditions(conditionRows(scene, hovered), rect.left + screen.x, rect.top + screen.y);
      return;
    }
    // A pin the GM made readable names its note when no token is there.
    const pin = pinAt(scene, this.camera.toWorld(this.hover), this.camera.current().zoom);
    if (pin) card.showText(pin.title ?? 'Note', rect.left + this.hover.x, rect.top + this.hover.y);
    else card.hide();
  }

  /** Opens the note of the readable pin under a click, when no token is there; false when there is none to open. */
  private openPinAt(point: ScreenPoint): boolean {
    const scene = this.scene;
    if (!scene || !this.note || !this.options.requestNote) return false;
    const world = this.camera.toWorld(point);
    if (tokenAt(scene, this.moves.overlay().positions, world)) return false;
    const pin = pinAt(scene, world, this.camera.current().zoom);
    if (!pin || !this.options.requestNote(pin.id)) return false;
    this.stopAwaitingNote();
    const win = this.options.canvas.ownerDocument.defaultView ?? window;
    const awaited = { sceneId: scene.sceneId, pinId: pin.id, timer: 0 };
    awaited.timer = win.setTimeout(() => {
      if (this.awaitedNote !== awaited) return;
      this.awaitedNote = null;
      this.note?.show(null);
    }, NOTE_WAIT_MS);
    this.awaitedNote = awaited;
    this.note.loading(pin.title ?? 'Note');
    return true;
  }

  private stopAwaitingNote(): void {
    if (this.awaitedNote) (this.options.canvas.ownerDocument.defaultView ?? window).clearTimeout(this.awaitedNote.timer);
    this.awaitedNote = null;
  }

  /** Selects the token under a click with Move, or none on the map, as a click in Atlas's scene does. */
  private select(point: ScreenPoint): void {
    const scene = this.scene;
    const id = scene ? tokenAt(scene, this.moves.overlay().positions, this.camera.toWorld(point)) : null;
    if (id === this.selected) return;
    this.selected = id;
    this.renderer.setOverlay(this.tokenOverlay());
    this.updateHoverCard();
  }

  private updateButtons(): void {
    this.options.viewButtons.hidden = !this.hasScene || this.camera.isFollowing();
  }

  private bind(): void {
    const { canvas, followButton, fitButton } = this.options;
    const { signal } = this.listeners;
    bindMapInput({
      canvas, input: this.input, tools: this.tools, signal,
      ...(this.options.active ? { active: this.options.active } : {}),
      ...(this.options.doc ? { doc: this.options.doc } : {}),
      onHover: (point) => {
        this.hover = point;
        this.updateCursor();
        this.updateHoverCard();
      },
    });
    // A click (a press that did not move) selects; a press that panned or dragged does not.
    canvas.addEventListener('pointerdown', (event) => { this.pressedAt = { x: event.clientX, y: event.clientY }; }, { signal });
    canvas.addEventListener('click', (event) => {
      const from = this.pressedAt;
      this.pressedAt = null;
      if (this.tools.tool !== 'move' || (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > CLICK_TOLERANCE)) return;
      const rect = canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      // A readable pin opens its note when no token is there: tokens win, as in Atlas.
      if (!this.openPinAt(point)) this.select(point);
    }, { signal });
    const doc = this.options.doc ?? document;
    const modifierFrom = (event: KeyboardEvent | MouseEvent): void => {
      const down = event.ctrlKey || event.metaKey;
      if (down === this.modifier) return;
      this.modifier = down;
      this.updateHoverCard();
    };
    doc.addEventListener('keydown', (event) => {
      modifierFrom(event);
      // Escape lets go of the selection, as in Atlas, when nothing above the map took it.
      if (event.key === 'Escape' && this.selected !== null && this.options.active?.() !== false && !event.defaultPrevented) this.select({ x: -1e9, y: -1e9 });
    }, { signal });
    doc.addEventListener('keyup', modifierFrom, { signal });
    canvas.addEventListener('pointermove', modifierFrom, { signal });
    followButton.addEventListener('click', () => this.camera.followGm(), { signal });
    fitButton.addEventListener('click', () => this.camera.fitMap(), { signal });
    document.addEventListener('visibilitychange', () => this.renderer.visibilityChanged(), { signal });
    if (typeof ResizeObserver === 'undefined') window.addEventListener('resize', () => this.measure(), { signal });
    else {
      this.resizeObserver = new ResizeObserver(() => this.measure());
      this.resizeObserver.observe(canvas);
    }
  }
}
