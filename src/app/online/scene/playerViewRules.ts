import type { AtlasSettingsView } from '@atlas-vtt/api-types';
import { PLAYER_VIEW_RULE_KEYS } from '@atlas-vtt/shared/rules';

/** The `localPlayerView` rules online players follow; the keys are Atlas's own `PLAYER_VIEW_RULE_KEYS`. */
export type PlayerViewRules = AtlasSettingsView['playerView'] & {
  /** The curtain is down (Atlas 0.12's "Hide the map", or Connect's own): players are sent a blank, black scene. */
  curtain?: boolean;
};

/** Only the rules, each strictly true or false; the curtain only where it is down. */
export function pickPlayerViewRules(settings: PlayerViewRules): PlayerViewRules {
  const rules = Object.fromEntries(PLAYER_VIEW_RULE_KEYS.map((key) => [key, settings[key] === true])) as PlayerViewRules;
  return settings.curtain === true ? { ...rules, curtain: true } : rules;
}

export function samePlayerViewRules(a: PlayerViewRules, b: PlayerViewRules): boolean {
  return PLAYER_VIEW_RULE_KEYS.every((key) => a[key] === b[key]) && (a.curtain === true) === (b.curtain === true);
}
