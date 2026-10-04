import type { Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';
import { sessionDeps } from '../app/online/atlas/sessionDeps';
import { OnlineSessionService, type Deps, type SessionSettings } from '../app/online/OnlineSessionService';
import { registerOnline } from '../app/online/registerOnline';
import { PeopleBook } from '../app/online/sharing/people/PeopleBook';
import { sharingPaths } from '../app/online/sharing/sharingPaths';
import { need } from './capabilities';

export interface ConnectOptions {
  /** Connect's own settings (`ConnectSettingsStore`). */
  settings: SessionSettings;
  /** Replaces parts of the hosting deps; tests pass an in-memory host and table. */
  hosting?: Partial<Deps>;
}

/** The namespaces hosting needs; null on an Atlas that lacks any of them. */
function hostingAtlas(api: AtlasApi, atlas: AtlasExtension): Pick<AtlasExtension, 'views' | 'presentation' | 'rules' | 'settings' | 'storage' | 'on'> | null {
  const views = need(api, atlas, 'views');
  const presentation = need(api, atlas, 'presentation');
  const rules = need(api, atlas, 'rules');
  const settings = need(api, atlas, 'settings');
  const storage = need(api, atlas, 'storage');
  if (!views || !presentation || !rules || !settings || !storage) return null;
  return { views, presentation, rules, settings, storage, on: atlas.on.bind(atlas) };
}

/** Hosting online sessions: the session service, its commands, the status bar item and the presentation target. */
async function startHosting(plugin: Plugin, atlas: NonNullable<ReturnType<typeof hostingAtlas>>, options: ConnectOptions): Promise<Disposer> {
  const people = PeopleBook.forApp(plugin.app, sharingPaths(await atlas.storage.folder()));
  const service = new OnlineSessionService(plugin.app, options.settings, { ...sessionDeps(atlas), people, ...options.hosting });
  return registerOnline(plugin, service, { presentation: atlas.presentation });
}

/** Starts every Connect feature this Atlas supports; the returned disposer stops them all (Atlas unloaded or Connect unloading). */
export function startConnect(plugin: Plugin, atlas: AtlasExtension, api: AtlasApi, options: ConnectOptions): Disposer {
  const stops: Disposer[] = [];
  let disposed = false;
  const keep = (stop: Disposer): void => {
    // Atlas may have gone while a feature was still starting: it stops at once.
    if (disposed) stop();
    else stops.push(stop);
  };
  const hosting = hostingAtlas(api, atlas);
  if (hosting) {
    startHosting(plugin, hosting, options).then(keep, (error: unknown) => {
      console.error('[Atlas VTT Connect] Could not start hosting online sessions:', error);
    });
  }
  return () => {
    disposed = true;
    for (const stop of stops.splice(0).reverse()) stop();
  };
}
