/**
 * The scene of a cutscene's map as its players see it for the length of the run: everything the shot shows, fog or no
 * fog, lit or not. A deliberate, bounded exception to "only what players may see leaves the GM's machine": it is sent
 * only to players whose client asked for it, never kept as explored or remembered, and dropped when the run ends. What
 * stays private still does: a GM-hidden token is not sent, and a closed secret door is plain wall.
 */
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import { MAX_CONTROL_MESSAGE_BYTES } from '../protocol';
import type { BoardExtras } from './boardTypes';
import { FogCoverage, type Shows } from './FogCoverage';
import { OPEN_FRAME } from './lightingFrame';
import { projectBoard } from './projectBoard';
import { projectForPlayers } from './projectForPlayers';
import type { ProjectionMemo } from './projectRecords';
import type { BoardLook } from './sceneContracts';
import type { PlayerScene } from './sceneTypes';
import { sceneContext, type SceneProjectionOptions } from './sceneSources';

/** What the projection reads of the session's options. */
export type CutsceneProjectionOptions = Pick<SceneProjectionOptions, 'settings' | 'assets' | 'collectionGrid' | 'coneAngle' | 'resources' | 'conditions' | 'initiativeRules' | 'handout' | 'resourceVisibility' | 'minis' | 'movement'>;

/** The scene's JSON may weigh this much: its message also carries an envelope. */
export const CUTSCENE_SCENE_BYTES = MAX_CONTROL_MESSAGE_BYTES - 8 * 1024;

const SHOWS_ALL: Shows = Object.freeze({ shows: () => true });
const encoder = new TextEncoder();

/** UTF-8 bytes of some JSON text, measured exactly only when it could be near `limit`. */
export function textBytes(text: string, limit = CUTSCENE_SCENE_BYTES): number {
  return text.length * 3 <= limit ? text.length : encoder.encode(text).length;
}

/** UTF-8 bytes of `scene` as JSON. */
export function sceneBytes(scene: PlayerScene): number {
  return textBytes(JSON.stringify(scene));
}

/** What is given up, in order, when the scene is too heavy for one message: the least needed to draw the shot first. */
const SHEDDING: ReadonlyArray<(scene: PlayerScene) => PlayerScene> = [
  // A cutscene has no fog: a fill may be all that covers part of the map, so it is never shed; the other drawings go first.
  (scene) => ({ ...scene, drawings: Object.fromEntries(Object.entries(scene.drawings).filter(([, drawing]) => drawing.fill !== undefined)) }),
  (scene) => ({ ...scene, texts: {} }),
  (scene) => ({ ...scene, pins: [] }),
  (scene) => ({ ...scene, widgets: [], initiative: null, handout: null }),
  (scene) => ({ ...scene, tokens: {} }),
];

export interface ProjectedCutscene {
  scene: PlayerScene;
  /** `scene` as JSON, serialised once. */
  sceneText: string;
  extras: BoardExtras;
  /** Whether the scene fits one message; false only when even the bare map does not. */
  fits: boolean;
}

export function projectCutscene(
  snapshot: SceneSnapshot, options: CutsceneProjectionOptions, look: BoardLook | null, sceneId: string, memo: ProjectionMemo,
  limit = CUTSCENE_SCENE_BYTES,
): ProjectedCutscene {
  const projected = projectForPlayers(snapshot, {
    sceneId,
    rules: { ...options.settings.getLocalPlayerViewSettings(), curtain: false },
    coverage: FogCoverage.EMPTY,
    lighting: OPEN_FRAME,
    assets: options.assets,
    ...sceneContext(snapshot, options),
  }, memo);
  let scene: PlayerScene = { ...projected, fog: {} };
  let sceneText = JSON.stringify(scene);
  // Too heavy for one message: shed until it fits, so the player always gets a scene to draw.
  for (const shed of SHEDDING) {
    if (textBytes(sceneText, limit) <= limit) break;
    scene = shed(scene);
    sceneText = JSON.stringify(scene);
  }
  const extras = projectBoard(snapshot, sceneId, SHOWS_ALL, projected.tokens, look, options.assets);
  return { scene, sceneText, extras, fits: textBytes(sceneText, limit) <= limit };
}
