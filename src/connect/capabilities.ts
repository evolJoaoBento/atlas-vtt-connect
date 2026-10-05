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
}

/** The namespace for `capability` when this Atlas has it; null on an older Atlas. */
export function need<K extends Extract<keyof NeedMap, AtlasCapability>>(api: AtlasApi, atlas: AtlasExtension, capability: K): NeedMap[K] | null {
  if (!api.has(capability)) return null;
  const namespaces: Partial<NeedMap> = atlas;
  return namespaces[capability] ?? null;
}
