/**
 * The card a player sees while the mouse rests on a token: its name and its conditions spelled out ("Frightened 2"),
 * and for a token they control its exact numbers (`TokenNumbers`, sent to them alone). Only what the scene already
 * sends players is shown: a token without a nameplate stays nameless here too. Shared with the web page.
 */
import { computeTokenPixelSize } from '@atlas-vtt/shared/draw';
import type { PlayerScene, ScenePoint } from '../scene/sceneTypes';

/** One line of the card: a condition (with its colour), or a number of the player's own token. */
export interface HoverLine {
  text: string;
  color?: string;
}

export interface HoverCard {
  /** The token's name; null when players are not shown it. */
  title: string | null;
  lines: HoverLine[];
}

/** Exact numbers of a token the player controls, by resource: what `token-stats` sends them. */
export interface TokenNumbers {
  resources: ReadonlyArray<{ name: string; current: number; max: number; color?: string }>;
}

/** The topmost token under a world point, as the tokens layer draws them: the art's circle at the position shown. */
export function tokenAt(scene: PlayerScene, positions: ReadonlyMap<string, ScenePoint>, point: ScenePoint): string | null {
  const cellSize = scene.map.cellSize;
  let top: { id: string; layer: number } | null = null;
  for (const [id, token] of Object.entries(scene.tokens)) {
    const at = positions.get(id) ?? token;
    const radius = Math.max(1, computeTokenPixelSize(cellSize, token.size)) / 2;
    if (Math.hypot(point.x - at.x, point.y - at.y) > radius) continue;
    if (!top || token.layer >= top.layer) top = { id, layer: token.layer };
  }
  return top?.id ?? null;
}

/** A condition as players read it: its name, with its number when it has one; unnamed ones are left out. */
function conditionText(condition: PlayerScene['tokens'][string]['conditions'][number]): string | null {
  const name = condition.name?.trim();
  if (!name) return null;
  return condition.value !== null && condition.value !== 1 ? `${name} ${condition.value}` : name;
}

const formatNumber = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** What the card says about token `id`; null when there is nothing to say (no name, no conditions, no numbers). */
export function hoverCardFor(scene: PlayerScene, id: string, numbers: TokenNumbers | null): HoverCard | null {
  const token = scene.tokens[id];
  if (!token) return null;
  const lines: HoverLine[] = [];
  for (const resource of numbers?.resources ?? []) {
    lines.push({ text: `${resource.name} ${formatNumber(resource.current)} / ${formatNumber(resource.max)}`, ...(resource.color ? { color: resource.color } : {}) });
  }
  for (const condition of token.conditions) {
    const text = conditionText(condition);
    if (text) lines.push({ text, ...(condition.color ? { color: condition.color } : {}) });
  }
  const title = token.name?.trim() || null;
  return title || lines.length > 0 ? { title, lines } : null;
}
