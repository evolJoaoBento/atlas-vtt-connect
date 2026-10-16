/**
 * The join page's tools.
 * - Move: pans the map, and drags the player's own tokens with Atlas's drag ruler.
 * - Measure: a line, a circle or a cone.
 * - Laser: shown to everyone.
 * - Ping: a tap shows rings at that point to everyone (`tools/pings.ts`).
 * - Template: a drag leaves the measure shape on the map for everyone; a tap on one of the player's own removes it.
 * These are the presses `ViewInput` hands to tokens. With Move, a press on one of the player's
 * tokens drags it and any other press pans. With Measure or Laser, every one-finger press is the
 * tool's. Two fingers always pinch and pan the map, which ends the gesture. Escape, or choosing
 * the active tool again, returns to Move. Shared with the web page.
 */
import { laserPointSpacing } from '@atlas-vtt/shared/draw';
import { RemoteLasers, type RemoteLaserFrame } from '@atlas-vtt/shared/draw';
import { DEFAULT_LASER_POINTER_SETTINGS } from '@atlas-vtt/shared/rules';
import type { PlayerScene, ScenePoint } from '../../scene/sceneTypes';
import { laserColor, swatchLaserColor } from '../../tools/laserColors';
import type { PlayerLaser } from '../../tools/toolMessages';
import { PingModel, type PingRing, type PlayerPing } from '../../tools/pings';
import { templateContains, type MapTemplate } from '../../tools/templates';
import type { ScreenPoint } from '../camera';
import type { TokenMoves } from '../TokenMoves';
import type { PointerKind, TokenGrab } from '../ViewInput';
import { DragRulerTool, type RulerOverlay } from './DragRulerTool';
import { LaserTool } from './LaserTool';
import { MeasureTool, type MeasureChoice, type MeasureOverlay } from './MeasureTool';
import { toolGridOf, type ToolGrid } from './toolGrid';

export type PlayerTool = 'move' | 'measure' | 'template' | 'laser' | 'ping';

/** What a player asks of the scene's templates. */
export type TemplateChange = { add: Pick<MapTemplate, 'shape' | 'start' | 'end'> } | { remove: string };

/** A drag shorter than this (screen pixels) is a tap: it removes a template rather than places one. */
const TEMPLATE_TAP = 8;

/** What the tools draw this frame. */
export interface ToolOverlay {
  measure: MeasureOverlay | null;
  ruler: RulerOverlay | null;
  /** Everyone's lasers, this player's own included. */
  lasers: RemoteLaserFrame[];
  /** Everyone's pings, this player's own included. */
  pings: PingRing[];
  /** The scene's lasting templates, and the one this player is placing (last). */
  templates: MapTemplate[];
  /** A cone's full opening, in radians: the GM's cone angle. */
  coneOpening: number;
}

export interface PlayerToolsOptions {
  moves: TokenMoves;
  /** A canvas point in world units, with the camera of now. */
  toWorld(point: ScreenPoint): ScenePoint;
  /** Screen pixels per world unit now, so laser points are spaced like Atlas's. */
  zoom(): number;
  now(): number;
  /** `color`: this player's pick, absent until they pick one (the GM then colours it by their place). */
  sendLaser(points: ScenePoint[], lifted: boolean, dt: number[], color?: string): boolean;
  /** Sends a ping at a world point; false when it could not go. Without it the Ping tool does nothing. */
  sendPing?(x: number, y: number): boolean;
  /** Asks the GM to add a template or remove one of the player's own; false when it could not go. */
  sendTemplate?(change: TemplateChange): boolean;
  /** The colour remembered from an earlier visit, if any. */
  laserColor?: string | null;
  /** The tool, the shape, or what the tools draw changed. */
  onChange(): void;
}

/** This player's own laser, among the others'. */
const SELF = 'self';

export class PlayerTools implements TokenGrab {
  private current: PlayerTool = 'move';
  private shapeChoice: MeasureChoice = 'line';
  /** The laser swatch this player picked; null until then, when the colour follows their place in the session. */
  private pickedColor: string | null;
  private scene: PlayerScene | null = null;
  private grid: ToolGrid | null = null;
  private order: readonly string[] = [];
  private self: string | null = null;
  private readonly measure = new MeasureTool();
  private readonly ruler: DragRulerTool;
  private readonly laser: LaserTool;
  private readonly lasers = new RemoteLasers();
  private readonly pings = new PingModel();
  /** The scene's lasting templates, as the GM last sent them. */
  private templates: MapTemplate[] = [];
  /** The template being dragged out. */
  private draft: { start: ScenePoint; end: ScenePoint } | null = null;
  /** The tool whose press is in progress: it gets the moves and the release. */
  private pressed: PlayerTool | null = null;
  private connected = false;

  constructor(private readonly options: PlayerToolsOptions) {
    this.pickedColor = swatchLaserColor(options.laserColor);
    this.ruler = new DragRulerTool(() => options.onChange());
    this.laser = new LaserTool({
      now: () => options.now(),
      send: (points, lifted, dt) => {
        options.sendLaser(points, lifted, dt, this.pickedColor ?? undefined);
        // A held laser sends empty batches to stay alive: they keep it alive here too.
        if (points.length === 0 && !lifted) this.lasers.receive(SELF, this.selfColor(), [], false, options.now());
      },
      echo: (points, lifted) => {
        // This player's own laser is drawn as it is made: no playback delay.
        this.lasers.receive(SELF, this.selfColor(), points, lifted, options.now(), { immediate: true });
      },
    });
  }

  get tool(): PlayerTool {
    return this.current;
  }

  get shape(): MeasureChoice {
    return this.shapeChoice;
  }

  /** Chooses a tool; choosing the active one again returns to Move. Ends any gesture. */
  select(tool: PlayerTool): void {
    this.endGesture();
    this.current = tool === this.current ? 'move' : tool;
    this.options.onChange();
  }

  /** The colour this player's laser has now: their pick, else the one their place in the session gives it. */
  get laserColor(): string {
    return this.selfColor();
  }

  /** Picks a laser colour (one of the swatches; others are ignored) and the laser tool with it; it applies from the next stroke. */
  selectLaserColor(color: string): boolean {
    const swatch = swatchLaserColor(color);
    if (!swatch) return false;
    this.endGesture();
    this.pickedColor = swatch;
    this.current = 'laser';
    this.options.onChange();
    return true;
  }

  /** Chooses the measure shape, and the measure tool with it. */
  selectShape(shape: MeasureChoice): void {
    this.endGesture();
    this.shapeChoice = shape;
    this.current = 'measure';
    this.options.onChange();
  }

  /** Escape: ends the gesture (a dragged token goes back) and returns to Move; false when there was nothing to do. */
  escape(): boolean {
    if (!this.pressed && this.current === 'move') return false;
    this.endGesture();
    this.current = 'move';
    this.options.onChange();
    return true;
  }

  /** The waypoint key: a waypoint while a token is dragged. */
  addWaypoint(): boolean {
    return this.pressed === 'move' && this.ruler.addWaypoint();
  }

  isDragging(): boolean {
    return this.pressed === 'move' && this.options.moves.isDragging();
  }

  /** A new scene (another `sceneId`) ends the gesture and drops every laser. */
  setScene(scene: PlayerScene | null): void {
    const changed = scene?.sceneId !== this.scene?.sceneId;
    this.scene = scene;
    this.grid = scene ? toolGridOf(scene) : null;
    if (changed) {
      this.endGesture();
      this.lasers.clear();
      this.pings.clear();
      this.templates = [];
    }
    this.options.onChange();
  }

  /** The session's players in order and this player's id: whose laser has which colour. */
  setPlayers(order: readonly string[], self: string | null): void {
    this.order = order;
    this.self = self;
  }

  /** Only an admitted player uses the tools: losing the connection ends the gesture and lets the laser go. */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (connected || !this.pressed) return;
    this.endGesture();
    this.options.onChange();
  }

  /** Someone else's laser; one for another scene is ignored. */
  receiveLaser(laser: PlayerLaser): void {
    if (!this.scene || laser.sceneId !== this.scene.sceneId) return;
    this.lasers.receive(laser.from, laser.color ?? laserColor(laser.from, this.order), laser.points, laser.lifted, this.options.now(), laser.dt ? { dt: laser.dt } : {});
    this.options.onChange();
  }

  /** The scene's templates, all of them, as the GM keeps them; a list for another scene is ignored. */
  receiveTemplates(sceneId: string, templates: readonly MapTemplate[]): void {
    if (!this.scene || sceneId !== this.scene.sceneId) return;
    this.templates = [...templates];
    this.options.onChange();
  }

  /** Someone else's ping; one for another scene is ignored. */
  receivePing(ping: PlayerPing): void {
    if (!this.scene || ping.sceneId !== this.scene.sceneId) return;
    this.pings.add({ x: ping.x, y: ping.y }, ping.color, this.options.now());
    this.options.onChange();
  }

  grab(point: ScreenPoint, kind: PointerKind): boolean {
    const grid = this.grid;
    if (!grid) return false;
    // Measure and laser need the session: tokens check their own connection.
    if (this.current !== 'move' && !this.connected) return false;
    if (this.current === 'move') {
      if (!this.options.moves.grab(point)) return false;
      const dragged = this.options.moves.dragged();
      if (dragged) this.ruler.begin(dragged.origin, grid, kind, this.tokenSize(dragged.tokenId));
    } else if (this.current === 'measure') {
      this.measure.begin(this.options.toWorld(point), grid);
    } else if (this.current === 'template') {
      const at = this.options.toWorld(point);
      this.draft = { start: at, end: at };
    } else if (this.current === 'ping') {
      // One tap, one ping: shown here at once, and sent to everyone else.
      const at = this.options.toWorld(point);
      if (this.options.sendPing?.(at.x, at.y)) this.pings.add(at, this.selfColor(), this.options.now());
    } else {
      this.laser.begin(this.options.toWorld(point));
    }
    this.pressed = this.current;
    this.options.onChange();
    return true;
  }

  /** `time`: when the pointer was there, on the page's clock (a laser times its points with it). */
  move(point: ScreenPoint, time?: number): void {
    const grid = this.grid;
    if (!this.pressed || !grid) return;
    if (this.pressed === 'move') {
      this.options.moves.move(point);
      const position = this.options.moves.dragged()?.position;
      if (position) this.ruler.update(position, point);
    } else if (this.pressed === 'measure') {
      this.measure.move(this.options.toWorld(point), grid);
    } else if (this.pressed === 'template') {
      if (this.draft) this.draft = { start: this.draft.start, end: this.options.toWorld(point) };
    } else if (this.pressed === 'ping') {
      return;
    } else {
      this.laser.move(this.options.toWorld(point), laserPointSpacing(DEFAULT_LASER_POINTER_SETTINGS.size, this.options.zoom()), time);
    }
    this.options.onChange();
  }

  drop(point: ScreenPoint): void {
    if (this.pressed === 'move') this.options.moves.drop(point);
    if (this.pressed === 'template') this.placeTemplate(this.options.toWorld(point));
    this.finishGesture();
  }

  cancel(): void {
    this.endGesture();
    this.options.onChange();
  }

  overlay(): ToolOverlay {
    return {
      measure: this.grid ? this.measure.overlay(this.shapeChoice, this.grid) : null,
      ruler: this.pressed === 'move' ? this.ruler.overlay() : null,
      lasers: this.lasers.frame(this.options.now()),
      pings: this.pings.frame(this.options.now()),
      templates: this.draft && this.pressed === 'template'
        ? [...this.templates, { id: 'draft', owner: this.self ?? SELF, shape: this.shapeChoice, start: this.draft.start, end: this.draft.end, color: this.selfColor() }]
        : this.templates,
      coneOpening: this.grid?.coneOpening ?? Math.PI / 2,
    };
  }

  /** A laser is fading: the view keeps drawing. */
  isAnimating(): boolean {
    return this.lasers.isActive || this.pings.active;
  }

  dispose(): void {
    this.endGesture();
    this.laser.dispose();
    this.lasers.clear();
    this.pings.clear();
  }

  /** A token's size in cells, as the scene sends it; 1 for one it does not hold. */
  private tokenSize(tokenId: string): number {
    const tokens = this.scene?.tokens;
    return (tokens && Object.hasOwn(tokens, tokenId) ? tokens[tokenId]?.size : undefined) || 1;
  }

  /** A drag places the measure shape as a template; a tap removes the player's own template under it. */
  private placeTemplate(end: ScenePoint): void {
    const draft = this.draft;
    this.draft = null;
    if (!draft) return;
    const zoom = this.options.zoom() || 1;
    const dragged = Math.hypot(end.x - draft.start.x, end.y - draft.start.y) * zoom;
    if (dragged >= TEMPLATE_TAP) {
      this.options.sendTemplate?.({ add: { shape: this.shapeChoice, start: draft.start, end } });
      return;
    }
    const opening = this.grid?.coneOpening ?? Math.PI / 2;
    const mine = [...this.templates].reverse()
      .find((template) => template.owner === this.self && templateContains(template, end, opening, TEMPLATE_TAP / zoom));
    if (mine) this.options.sendTemplate?.({ remove: mine.id });
  }

  private selfColor(): string {
    return this.pickedColor ?? laserColor(this.self ?? SELF, this.order);
  }

  /** Released: the measurement goes, the ruler goes, the laser is let go. */
  private finishGesture(): void {
    this.draft = null;
    this.measure.clear();
    this.ruler.end();
    this.laser.lift();
    this.pressed = null;
    this.options.onChange();
  }

  /** Interrupted: as released, and a dragged token goes back instead of dropping. */
  private endGesture(): void {
    if (this.pressed === 'move') this.options.moves.cancel();
    this.draft = null;
    this.measure.clear();
    this.ruler.end();
    this.laser.lift();
    this.pressed = null;
  }
}
