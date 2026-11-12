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
export type CutsceneProjectionOptions = Pick<SceneProjectionOptions, 'settings' | 'assets' | 'collectionGrid' | 'coneAngle' | 'resources' | 'conditions' | 'initiativeRules' | 'handout' | 'resourceVisibility' | 'minis'>;

/** The scene's JSON may weigh this much: its message also carries an envelope. */
export const CUTSCENE_SCENE_BYTES = MAX_CONTROL_MESSAGE_BYTES - 8 * 1024;

const SHOWS_ALL: Shows = Object.freeze({ shows: () => true });
const encoder = new TextEncoder();

/** UTF-8 bytes of `scene` as JSON, measured exactly only when it could be near the cap. */
export function sceneBytes(scene: PlayerScene): number {
  const text = JSON.stringify(scene);
  return text.length * 3 <= CUTSCENE_SCENE_BYTES ? text.length : encoder.encode(text).length;
}

export function projectCutscene(
  snapshot: SceneSnapshot, options: CutsceneProjectionOptions, look: BoardLook | null, sceneId: string, memo: ProjectionMemo,
): { scene: PlayerScene; extras: BoardExtras } {
  const projected = projectForPlayers(snapshot, {
    sceneId,
    rules: { ...options.settings.getLocalPlayerViewSettings(), curtain: false },
    coverage: FogCoverage.EMPTY,
    lighting: OPEN_FRAME,
    assets: options.assets,
    ...sceneContext(snapshot, options),
  }, memo);
  let scene: PlayerScene = { ...projected, fog: {} };
  // Too heavy for one message: drawings go first, then texts.
  if (sceneBytes(scene) > CUTSCENE_SCENE_BYTES) scene = { ...scene, drawings: {} };
  if (sceneBytes(scene) > CUTSCENE_SCENE_BYTES) scene = { ...scene, texts: {} };
  const extras = projectBoard(snapshot, sceneId, SHOWS_ALL, scene.tokens, look, options.assets);
  return { scene, extras };
}
