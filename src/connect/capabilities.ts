import type { AtlasApi, AtlasCapability, AtlasExtension } from '@atlas-vtt/api-types';

/** The namespace each capability brings; gains one entry per synced namespace (decision D2). */
export interface NeedMap {
  views: AtlasExtension['views'];
  presentation: AtlasExtension['presentation'];
  rules: AtlasExtension['rules'];
  settings: AtlasExtension['settings'];
  storage: AtlasExtension['storage'];
  dice: AtlasExtension['dice'];
  lasers: AtlasExtension['lasers'];
  lighting: AtlasExtension['lighting'];
  tokens: AtlasExtension['tokens'];
  ui: AtlasExtension['ui'];
  scenes: AtlasExtension['scenes'];
  bundles: AtlasExtension['bundles'];
}

/**
 * The members each namespace must have as functions before Connect uses it: every required method of the vendored
 * types. Optional ones (`dice.throw`, `scenes.replaceMap`) are checked where they are called. A capability whose
 * namespace lacks one counts as missing, so that feature degrades as on an Atlas without it; minors are never compared.
 */
export const REQUIRED_MEMBERS: { readonly [K in keyof NeedMap]: ReadonlyArray<keyof NeedMap[K]> } = {
  views: ['list', 'active', 'snapshot', 'subscribe', 'camera', 'watchCamera'],
  presentation: ['current', 'present', 'stop', 'subscribe', 'addTarget'],
  rules: ['forMap'],
  settings: ['get'],
  storage: ['folder'],
  dice: ['roll', 'onRolled', 'publish'],
  lasers: ['onLocal', 'show'],
  lighting: ['playerVisibility', 'watch'],
  tokens: ['snapPoint', 'move'],
  ui: ['addToolbarItem', 'addPaletteSection', 'addDashboardTile', 'addViewMenuItems', 'addTokenMenuItems', 'addPanel', 'invalidate'],
  scenes: ['list', 'findByMap', 'getData', 'setData', 'readMap', 'addToCollection'],
  bundles: ['stripNoteProperties', 'forgetNoteProperties'],
};

/** The namespace for `capability` when this Atlas has it and every member Connect calls; null otherwise. */
export function need<K extends Extract<keyof NeedMap, AtlasCapability>>(api: AtlasApi, atlas: AtlasExtension, capability: K): NeedMap[K] | null {
  if (!api.has(capability)) return null;
  const namespaces: Partial<NeedMap> = atlas;
  const namespace = namespaces[capability];
  if (typeof namespace !== 'object' || namespace === null) return null;
  const members = namespace as unknown as Record<string, unknown>;
  return REQUIRED_MEMBERS[capability].every((member) => typeof members[member as string] === 'function') ? namespace : null;
}
