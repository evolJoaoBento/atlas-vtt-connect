import type { AtlasSettingsView } from '@atlas-vtt/api-types';
import { PLAYER_VIEW_RULE_KEYS } from '@atlas-vtt/shared/rules';

/** The `localPlayerView` rules online players follow; the keys are Atlas's own `PLAYER_VIEW_RULE_KEYS`. */
export type PlayerViewRules = AtlasSettingsView['playerView'];

/** Only the four rules, each strictly true or false. */
export function pickPlayerViewRules(settings: PlayerViewRules): PlayerViewRules {
  return Object.fromEntries(PLAYER_VIEW_RULE_KEYS.map((key) => [key, settings[key] === true])) as PlayerViewRules;
}

export function samePlayerViewRules(a: PlayerViewRules, b: PlayerViewRules): boolean {
  return PLAYER_VIEW_RULE_KEYS.every((key) => a[key] === b[key]);
}
