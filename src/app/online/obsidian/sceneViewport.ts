/**
 * What the player tab (`CanvasScene`) asks of the view that draws the scene: the join page's 2D map (`MapView`) or
 * Tabletop's 3D board (`BoardSceneView`). Both take the same scene, tools and session news.
 */
import type { ToolState } from '../../../../online-client/mapView.mts';
import type { SceneCamera } from '../scene/sceneCamera';
import type { PlayerScene } from '../scene/sceneTypes';
import type { PinNoteAnswer } from '../tools/pinNotes';
import type { PlayerPing } from '../tools/pings';
import type { TokenSheet } from '../tools/sheets';
import type { MapTemplate, TemplateShape } from '../tools/templates';
import type { PlayerLaser } from '../tools/toolMessages';
import type { MeasureChoice } from '../view/tools/MeasureTool';
import type { PlayerTool } from '../view/tools/PlayerTools';

export interface SceneViewport {
  setScene(scene: PlayerScene | null): void;
  setSheets(entries: readonly TokenSheet[]): void;
  setGmCamera(camera: SceneCamera | null): void;
  setControlled(tokenIds: readonly string[]): void;
  setConnected(connected: boolean): void;
  moveRefused(tokenId: string): void;
  setPaused(paused: boolean): void;
  selectTool(tool: PlayerTool): void;
  followGm(): void;
  fitMap(): void;
  selectTemplateShape(shape: TemplateShape): void;
  clearOwnTemplates(): void;
  selectShape(shape: MeasureChoice): void;
  selectLaserColor(color: string): void;
  selectLaserSize(size: number): void;
  toolState(): ToolState;
  setPlayers(order: readonly string[], self: string | null): void;
  receiveNote(answer: PinNoteAnswer): void;
  receiveTemplates(sceneId: string, templates: readonly MapTemplate[]): void;
  receivePing(ping: PlayerPing): void;
  receiveLaser(laser: PlayerLaser): void;
  refresh(): void;
  measure(): void;
  dispose(): void;
}
