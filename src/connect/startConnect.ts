import type { Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';

/** Starts every Connect feature this Atlas supports; the returned disposer stops them all (Atlas unloaded or Connect unloading). */
export function startConnect(plugin: Plugin, atlas: AtlasExtension, api: AtlasApi): Disposer {
  const stops: Disposer[] = [];
  void plugin; void atlas; void api;
  return () => { for (const stop of stops.splice(0).reverse()) stop(); };
}
