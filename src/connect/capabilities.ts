import type { AtlasApi, AtlasCapability, AtlasExtension } from '@atlas-vtt/api-types';

/** The namespace each capability brings; gains one entry per synced namespace (decision D2). */
export type NeedMap = Record<never, never>;

/** The namespace for `capability` when this Atlas has it; null on an older Atlas. */
export function need<K extends Extract<keyof NeedMap, AtlasCapability>>(api: AtlasApi, atlas: AtlasExtension, capability: K): NeedMap[K] | null {
  if (!api.has(capability)) return null;
  const namespace = (atlas as unknown as Record<string, unknown>)[capability === 'remote-view' ? 'remoteViews' : capability];
  return (namespace ?? null) as NeedMap[K] | null;
}
