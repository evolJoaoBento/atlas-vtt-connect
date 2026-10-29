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
}

/** What the board throws: dice by kind, the modifier, and the sheet roll it is for, handed back with the result unchanged. */
export interface PlayerDiceRequest {
  dice: Partial<Record<'d4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100', number>>;
  modifier: number;
  advantage?: 'advantage' | 'disadvantage';
  label?: string;
  colors?: Partial<Record<'d4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100', string>>;
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
