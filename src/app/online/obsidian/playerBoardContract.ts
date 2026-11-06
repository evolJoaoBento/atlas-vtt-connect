/**
 * Tabletop's player board (`app.plugins.plugins['atlas-vtt-tabletop'].api.playerBoard`, version 1): its 3D board drawn
 * in Connect's player tab from the scene Connect receives. Connect gives it the scene, the board extras, the GM's
 * cameras and what others do; it hands back the player's moves, pings, lasers, templates, pins and hovers. Tabletop
 * keeps a copy of these shapes (`src/connectContract.ts`); they must stay the same.
 */
import type { BoardCamera, BoardExtras, BoardPoint } from '../scene/boardTypes';
import type { SceneCamera } from '../scene/sceneCamera';
import type { PlayerScene, ScenePoint } from '../scene/sceneTypes';
import type { PlayerPing } from '../tools/pings';
import type { MapTemplate } from '../tools/templates';
import type { SheetRollRef } from '../tools/sheets';
import type { OfferedDiceRules, PhysicalRoll, PlayerLaser } from '../tools/toolMessages';
import type { TemplateChange } from '../view/tools/PlayerTools';

export interface PlayerBoardHost {
  /** An image of the scene (map, token, material map) as a URL the board can load; null while it is not here. */
  image(id: string): string | null;
  /** A model's GLB bytes (a mini, a prop, a door's prop); null while they are not here. */
  model(id: string): ArrayBuffer | null;
  sendMove(tokenId: string, x: number, y: number): boolean;
  sendLaser(points: ScenePoint[], lifted: boolean, dt: number[], color?: string): boolean;
  sendPing(x: number, y: number): boolean;
  sendTemplate(change: TemplateChange): boolean;
  /** The player clicked a readable pin: its note is asked for and shown. */
  openPin(pinId: string): void;
  /** The token under the pointer (null for none), where the pointer is in client pixels, and whether Ctrl or Cmd is down. */
  hover(tokenId: string | null, client: BoardPoint | null, modifier: boolean): void;
  /** The tool, shape or colour changed on the board (Escape too): the toolbar follows. */
  toolsChanged(): void;
  /** Sends a finished throw to the GM; false when it could not. Without it the board has no dice. */
  sendDiceResult?(result: PhysicalRoll): boolean;
  /** The rules of the player's map as the GM offered them; null for the default rules. */
  diceRules?(): OfferedDiceRules | null;
}

export type PlayerBoardTool = 'move' | 'measure' | 'template' | 'laser' | 'ping';

export interface PlayerBoardToolState {
  tool: PlayerBoardTool;
  shape: 'line' | 'circle' | 'cone';
  templateShape: string;
  ownTemplates: boolean;
  laserColor: string;
  /** Whether the GM's 3D view is known, for the GM view button. */
  gmView: boolean;
}

export interface PlayerBoardHandle {
  setScene(scene: PlayerScene | null): void;
  setExtras(extras: BoardExtras | null): void;
  /** The GM's 3D camera (for the GM view button), and the 2D one (the first view before a 3D one is known). */
  setGmCamera(camera: BoardCamera | null): void;
  setGmMapCamera(camera: SceneCamera | null): void;
  setControlled(tokenIds: readonly string[]): void;
  setConnected(connected: boolean): void;
  setPaused(paused: boolean): void;
  moveRefused(tokenId: string): void;
  setPlayers(order: readonly string[], self: string | null): void;
  selectTool(tool: PlayerBoardTool): void;
  selectShape(shape: 'line' | 'circle' | 'cone'): void;
  selectTemplateShape(shape: string): void;
  selectLaserColor(color: string): void;
  clearOwnTemplates(): void;
  toolState(): PlayerBoardToolState;
  /** Glides to the GM's 3D view. */
  followGm(): void;
  fitMap(): void;
  /** Moves the camera to a point of the map (an initiative card's click); absent from an older Tabletop. */
  lookAt?(x: number, y: number): void;
  /** This board sees through a token's eyes (`seeFrom`); absent from an older Tabletop. */
  readonly firstPerson?: true;
  /**
   * Sees through a token's eyes, the phone's gyroscope turning the view when `gyro` (the caller has the permission), a drag
   * otherwise; null goes back to the usual camera. False for a token the board does not have.
   */
  seeFrom?(tokenId: string | null, gyro: boolean): boolean;
  /** The token the view is seen through, or null. */
  seeingFrom?(): string | null;
  /** This board draws over a phone's camera picture (`setAugmented`); absent from an older Tabletop. */
  readonly augmentedReality?: true;
  /** Augmented reality: the phone camera's pose over the printed marker sheet for one frame; null: the usual camera. */
  setAugmented?(view: AugmentedView | null): boolean;
  /** This board draws into a WebXR immersive AR session (room tracking); absent from an older Tabletop. */
  readonly roomAr?: true;
  /** Room tracking: draws into the session; `onFrame` hears each XRFrame (and the local reference space) first. */
  startRoomAr?(session: unknown, onFrame: ((frame: unknown, space: unknown) => void) | null): Promise<boolean>;
  /** Room tracking: stands the board at a point of the room (`RoomPlace`); null hides it. */
  placeRoomAr?(place: RoomPlace | null): void;
  /** Ends room tracking. */
  stopRoomAr?(): void;
  /** Room tracking's frame times (milliseconds) and errors, for a look; null when it is off. */
  roomStats?(): { frames: number; intervalMs: number; workMs: number; errors: number; lastError: string } | null;
  receiveTemplates(sceneId: string, templates: readonly MapTemplate[]): void;
  receivePing(ping: PlayerPing): void;
  receiveLaser(laser: PlayerLaser): void;
  /** Images or models arrived or went. */
  refresh(): void;
  measure(): void;
  dispose(): void;
  /** This board throws dice (`throwDice`): set when Connect can send a roll (`sendDiceResult`). */
  readonly diceAvailable?: true;
  /** Throws the roll on the board (one still settling is dropped, unsent); false when there are no dice or no scene. */
  throwDice?(request: PlayerDiceRequest): boolean;
  /**
   * This board throws a die again under a reroll rule (`PlayerDiceRequest.reroll`) and marks the die it threw away
   * `rerolled`. Set by a Tabletop that does: one that does not ignores `reroll`, throws the dice plain and sends no mark,
   * which the GM would refuse, so Connect asks for a reroll only of a board that says so.
   */
  readonly rerolls?: true;
}

/** What the board throws: dice by kind, the modifier, and the sheet roll it is for, handed back with the result unchanged. */
export interface PlayerDiceRequest {
  dice: Partial<Record<'d4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100', number>>;
  modifier: number;
  advantage?: 'advantage' | 'disadvantage';
  label?: string;
  colors?: Partial<Record<'d4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100', string>>;
  /**
   * Per kind of die, a reroll rule (Atlas's `r`, `ro`, `rr`): a die meeting `op value` is thrown again, up to `limit` times
   * (1 for `r` and `ro`, 10 for `rr`); the die thrown away stays in the roll, marked `rerolled`. Applies to a whole kind.
   * Sent only to a board that says it `rerolls`.
   */
  reroll?: Partial<Record<'d4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100', { op: '<' | '<=' | '>' | '>=' | '='; value: number; limit: number }>>;
  sheet?: { tokenId: string; roll: SheetRollRef };
}

export interface PlayerBoardFactory {
  version: 1;
  create(parent: HTMLElement, host: PlayerBoardHost): PlayerBoardHandle;
}

/** Tabletop's `playerBoard`, checked: null for anything else. */
export function asPlayerBoardFactory(value: unknown): PlayerBoardFactory | null {
  const factory = value as Partial<PlayerBoardFactory> | null;
  return typeof factory === 'object' && factory !== null && factory.version === 1 && typeof factory.create === 'function' ? factory as PlayerBoardFactory : null;
}

/**
 * The phone camera over the printed marker sheet, for Tabletop's board (its `AugmentedView`): the turn (row by row) and
 * place (millimetres) taking sheet points to the camera's (x right, y down the picture, z ahead); the picture's edges as
 * tangents from the camera; how long a square of the map is on the table; the token standing on the sheet's middle
 * (null: the map's middle).
 */
export interface AugmentedView {
  readonly rotation: readonly number[];
  readonly translation: readonly number[];
  readonly frustum: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  readonly squareMm: number;
  readonly anchor: string | null;
  /** The camera's picture the pose was found for, drawn behind the board (absent: the page shows the picture itself). */
  readonly background?: HTMLCanvasElement;
}

/** Room tracking: where the board stands, in the room's metres (WebXR's local space, y up); see Tabletop's `RoomPlace`. */
export interface RoomPlace {
  readonly position: readonly number[];
  /** Which way the map's up faces, as a turn about the room's up from its −z (radians). */
  readonly yaw: number;
  readonly squareMm: number;
  readonly anchor: string | null;
}
