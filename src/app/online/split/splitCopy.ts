/**
 * Every string of the split party (spec section 3), in sentence case; player and scene names are shown as given.
 * Shared with the web page (the paused banner, the dice label), so this file imports only the limits beside it.
 */
import { SPLIT_LIMITS } from './splitLimits';

const MAX_SCENES = SPLIT_LIMITS.scenesInUse;

/** The heading row of the eye menu's section. */
export const PRESENT_TO_HEADING = 'Present to';

/** Where a row's player is, from the row's tab: on it, on another scene, or on none (nothing presented). */
export type RowPlace = { kind: 'here' } | { kind: 'on'; scene: string } | { kind: 'no-scene' };

/** A player row of both menus (spec 3.4): "Anna", "Anna · on Cave", "Anna · no scene", each with " · disconnected". */
export function rowLabel(name: string, place: RowPlace, disconnected: boolean): string {
  const where = place.kind === 'on' ? ` · on ${place.scene}` : place.kind === 'no-scene' ? ' · no scene' : '';
  return `${name}${where}${disconnected ? ' · disconnected' : ''}`;
}

/** The popover's one disabled row with no admitted or disconnected players. */
export const NO_PLAYERS_ROW = 'No players connected';

export const EVERYONE_BACK_LABEL = 'Everyone back to the presented scene';
/** The palette and Obsidian command. */
export const EVERYONE_BACK_COMMAND = 'Bring all players back to the presented scene';

/** Added to a menu's heading row while a row is disabled by the cap. */
export const CAP_NOTE = `At most ${MAX_SCENES} scenes at once`;

/** The panel's status at the cap. */
export function capPanelNote(): string {
  return `Players are on ${MAX_SCENES} scenes, the most at once. Bring players back to free one.`;
}

/** Follows "Players see {scene}." in the presenting block while `assigned` players are on other scenes. */
export function splitStatus(assigned: number): string {
  return assigned === 1 ? '1 player is on another scene.' : `${assigned} players are on other scenes.`;
}

/** The chip on an assigned player's row in the player list. */
export function sceneChip(scene: string): string {
  return `On ${scene}`;
}

/** "Anna", "Anna and Ben", "Anna, Ben and Cara". */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The GM's notice when a tab with players on it closed. */
export function closedNotice(names: readonly string[], scene: string): string {
  return `${nameList(names)} went back to the presented scene: ${scene} was closed.`;
}

/** Over a parked scene's map, on the player's side. */
export const PAUSED_BANNER = "The GM is on another scene. You can't move tokens until they're back.";

/** The presenting block's one line on an Atlas without `scene-tabs`, in place of the "Present to:" button. */
export const UPDATE_ATLAS_NOTE = 'Update Atlas VTT to show different scenes to different players.';

/** The GM's notice when a never-live tab could not be switched to, so its assignment was undone. */
export function couldntOpen(scene: string): string {
  return `Couldn't open ${scene}.`;
}

/** The mark after a tab's eye: how many players see that tab. */
export function badge(players: number): string {
  return players === 1 ? '1 player' : `${players} players`;
}

/** A player roll in the dice log while more than one scene is in use: "Anna · Cave". */
export function diceRollerLabel(name: string, scene: string): string {
  return `${name} · ${scene}`;
}
