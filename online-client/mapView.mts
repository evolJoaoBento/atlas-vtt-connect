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
import type { ScreenPoint } from '../src/app/online/view/camera';
import { CameraController } from '../src/app/online/view/CameraController';
import type { ImageLookup } from '../src/app/online/view/layers/layerTypes';
import { createSceneLayers } from '../src/app/online/view/layers/sceneLayers';
import { pixelRatioFor, PlayerViewRenderer } from '../src/app/online/view/PlayerViewRenderer';
import { TokenMoves } from '../src/app/online/view/TokenMoves';
import type { MeasureChoice } from '../src/app/online/view/tools/MeasureTool';
import { PlayerTools, type PlayerTool } from '../src/app/online/view/tools/PlayerTools';
import { createToolsLayer } from '../src/app/online/view/tools/toolsLayer';
import { ViewInput } from '../src/app/online/view/ViewInput';
import type { ViewSurface } from '../src/app/online/view/ViewSurface';
import { bindMapInput } from './mapInput.mts';

/** What the toolbar shows of the tools. */
export interface ToolState {
  tool: PlayerTool;
  shape: MeasureChoice;
  laserColor: string;
}

export interface MapViewOptions {
  canvas: HTMLCanvasElement;
  surface: ViewSurface;
  images: ImageLookup;
  /** Holds Follow GM and Fit map, shown while the player has broken away. */
  viewButtons: HTMLElement;
  followButton: HTMLButtonElement;
  fitButton: HTMLButtonElement;
  /** Sends one drop of a controlled token; false when it could not be sent. */
  sendMove(tokenId: string, x: number, y: number): boolean;
  /** Sends new points of the player's laser; false when they could not be sent. */
  sendLaser(points: ScenePoint[], lifted: boolean, dt: number[], color?: string): boolean;
  /** The laser colour remembered from an earlier visit. */
  laserColor?: string | null;
  /** The player picked a laser colour: remember it. */
  onLaserColor?(color: string): void;
  /** Shows "Move not allowed." after a refused move. */
  notice: HTMLElement;
  /** The tool or measure shape changed, also by Escape: the toolbar follows. */
  onToolsChange?(): void;
  /** Tests pass their own; the page uses the browser's animation frames, visibility and clock. */
  frames?: { request(draw: () => void): number; cancel(handle: number): void };
  isHidden?: () => boolean;
  now?: () => number;
}

export class MapView {
  private readonly camera: CameraController;
  private readonly renderer: PlayerViewRenderer;
  private readonly moves: TokenMoves;
  private readonly tools: PlayerTools;
  private readonly input: ViewInput;
  private hasScene = false;
  /** Where the mouse is over the canvas, for the grab cursor; null when it is elsewhere. */
  private hover: ScreenPoint | null = null;
  /** What the toolbar was last told. */
  private shownTool: ToolState = { tool: 'move', shape: 'line', laserColor: '' };
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
      layers: createSceneLayers(),
      // Read at draw time, once the tools exist.
      overlays: [createToolsLayer({ overlay: () => this.tools.overlay(), isAnimating: () => this.tools.isAnimating() })],
      requestFrame: (draw) => frames.request(draw),
      cancelFrame: (handle) => frames.cancel(handle),
      isHidden: options.isHidden ?? ((): boolean => document.hidden),
    });
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
      sendLaser: (points, lifted, dt, color) => options.sendLaser(points, lifted, dt, color),
      laserColor: options.laserColor ?? null,
      onChange: () => this.toolsChanged(),
    });
    this.input = new ViewInput(this.camera, this.tools);
    options.canvas.dataset.tool = this.shownTool.tool;
    this.bind();
    this.measure();
  }

  /** The scene to show; null shows nothing and resets the camera. */
  setScene(scene: PlayerScene | null): void {
    this.hasScene = scene !== null;
    this.camera.setScene(scene);
    this.renderer.setScene(scene);
    this.moves.setScene(scene);
    this.tools.setScene(scene);
    this.updateButtons();
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

  /** Chooses a tool; the active one again returns to Move. */
  selectTool(tool: PlayerTool): void {
    this.tools.select(tool);
  }

  selectShape(shape: MeasureChoice): void {
    this.tools.selectShape(shape);
  }

  selectLaserColor(color: string): void {
    if (this.tools.selectLaserColor(color)) this.options.onLaserColor?.(this.tools.laserColor);
  }

  toolState(): ToolState {
    return { tool: this.tools.tool, shape: this.tools.shape, laserColor: this.tools.laserColor };
  }

  /** The session's players in order and this player's id: whose laser has which colour. */
  setPlayers(order: readonly string[], self: string | null): void {
    this.tools.setPlayers(order, self);
    // The laser colour follows a player's place until they pick one.
    this.toolsChanged();
  }

  receiveLaser(laser: PlayerLaser): void {
    this.tools.receiveLaser(laser);
  }

  /** Images arrived or went. */
  refresh(): void {
    this.renderer.invalidate();
  }

  /** The session is over: stops drawing and frees the fog image. The page does not use the view again. */
  dispose(): void {
    this.listeners.abort();
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

  private movesChanged(): void {
    this.renderer.setOverlay(this.moves.overlay());
    const notice = this.moves.notice();
    this.options.notice.textContent = notice ?? '';
    this.options.notice.hidden = notice === null;
    this.updateCursor();
  }

  /** Draws again; the toolbar hears only of a new tool or shape, never of every move. */
  private toolsChanged(): void {
    this.renderer.invalidate();
    const state = this.toolState();
    if (state.tool === this.shownTool.tool && state.shape === this.shownTool.shape && state.laserColor === this.shownTool.laserColor) return;
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

  private updateButtons(): void {
    this.options.viewButtons.hidden = !this.hasScene || this.camera.isFollowing();
  }

  private bind(): void {
    const { canvas, followButton, fitButton } = this.options;
    const { signal } = this.listeners;
    bindMapInput({
      canvas, input: this.input, tools: this.tools, signal,
      onHover: (point) => {
        this.hover = point;
        this.updateCursor();
      },
    });
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
