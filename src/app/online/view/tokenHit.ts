/**
 * Which of the player's tokens is under a world point, as the tokens layer draws them:
 * the art's circle, at the position shown (a drag or drop preview included), the one
 * drawn last (highest layer, then latest in the scene) on top. Shared with the web page.
 */
import { computeTokenPixelSize } from '@atlas-vtt/shared/draw';
import type { PlayerScene, ScenePoint } from '../scene/sceneTypes';

export function controlledTokenAt(
  scene: PlayerScene,
  controlled: ReadonlySet<string>,
  positions: ReadonlyMap<string, ScenePoint>,
  point: ScenePoint,
): string | null {
  const cellSize = scene.map.cellSize;
  let top: { id: string; layer: number } | null = null;
  for (const [id, token] of Object.entries(scene.tokens)) {
    if (!controlled.has(id)) continue;
    const at = positions.get(id) ?? token;
    // The same size the layer draws, never below a pixel.
    const radius = Math.max(1, computeTokenPixelSize(cellSize, token.size)) / 2;
    if (Math.hypot(point.x - at.x, point.y - at.y) > radius) continue;
    if (!top || token.layer >= top.layer) top = { id, layer: token.layer };
  }
  return top?.id ?? null;
}
