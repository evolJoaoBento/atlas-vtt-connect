import type { AtlasSettingsView } from '@atlas-vtt/api-types';
import { PLAYER_VIEW_RULE_KEYS } from '@atlas-vtt/shared/rules';
import { readDragDistance, type DragDistance } from '../../../../packages/atlas-shared/src/index';

/** The `localPlayerView` rules online players follow; the keys are Atlas's own `PLAYER_VIEW_RULE_KEYS`. */
export type PlayerViewRules = AtlasSettingsView['playerView'] & {
  /** The curtain is down (Atlas 0.12's "Hide the map", or Connect's own): players are sent a blank, black scene. */
  curtain?: boolean;
  /** When a dragged token shows its distance (Atlas 0.15's setting); absent is `always`. */
  dragDistance?: DragDistance;
};

/** Only the rules, each strictly true or false; the curtain only where it is down; the drag-distance choice only where it is not `always`. */
export function pickPlayerViewRules(settings: PlayerViewRules): PlayerViewRules {
  const rules = Object.fromEntries(PLAYER_VIEW_RULE_KEYS.map((key) => [key, settings[key] === true])) as unknown as PlayerViewRules;
  const dragDistance = readDragDistance(settings.dragDistance);
  return { ...rules, ...(settings.curtain === true && { curtain: true }), ...(dragDistance !== 'always' && { dragDistance }) };
}

export function samePlayerViewRules(a: PlayerViewRules, b: PlayerViewRules): boolean {
  return PLAYER_VIEW_RULE_KEYS.every((key) => a[key] === b[key]) && (a.curtain === true) === (b.curtain === true)
    && readDragDistance(a.dragDistance) === readDragDistance(b.dragDistance);
}
