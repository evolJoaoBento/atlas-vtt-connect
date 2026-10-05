// Copied from Atlas VTT src/app/types/initiativeTypes.ts at abc1cea (AGPL-3.0-only): only the defaults, the types are the API's.
import type { InitiativeState } from '@atlas-vtt/api-types';

/**
 * Default configuration for initiative
 */
export const DEFAULT_INITIATIVE_CONFIG: InitiativeState['config'] = {
  autoSort: true,
};

/**
 * Default empty initiative state
 */
export const createDefaultInitiativeState = (): InitiativeState => ({
  entries: [],
  currentIndex: -1,
  round: 0,
  isActive: false,
  config: { ...DEFAULT_INITIATIVE_CONFIG },
});
