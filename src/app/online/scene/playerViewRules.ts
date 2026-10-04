import type { AtlasSettingsView } from '@atlas-vtt/api-types';

/** The `localPlayerView` rules online players follow (Atlas's `PLAYER_VIEW_RULE_KEYS`). */
export const PLAYER_VIEW_RULE_KEYS = [
  'showGrid', 'showTokenNameplates', 'showWidgets', 'showInitiative',
] as const satisfies readonly (keyof AtlasSettingsView['playerView'])[];

export type PlayerViewRules = Pick<AtlasSettingsView['playerView'], typeof PLAYER_VIEW_RULE_KEYS[number]>;

/** Only the four rules, each strictly true or false. */
export function pickPlayerViewRules(settings: PlayerViewRules): PlayerViewRules {
  return {
    showGrid: settings.showGrid === true,
    showTokenNameplates: settings.showTokenNameplates === true,
    showWidgets: settings.showWidgets === true,
    showInitiative: settings.showInitiative === true,
  };
}

export function samePlayerViewRules(a: PlayerViewRules, b: PlayerViewRules): boolean {
  return PLAYER_VIEW_RULE_KEYS.every((key) => a[key] === b[key]);
}
