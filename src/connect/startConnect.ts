import type { Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';
import { sessionDeps } from '../app/online/atlas/sessionDeps';
import { isInSession, joinedSessionStore } from '../app/online/obsidian/joinedSessionStore';
import { openJoinSessionModal } from '../app/online/obsidian/ui/JoinSessionModal';
import { OnlineSessionService, type Deps } from '../app/online/OnlineSessionService';
import { registerGmUi } from '../app/online/gm-ui/registerGmUi';
import { registerOnline } from '../app/online/registerOnline';
import { PeopleBook } from '../app/online/sharing/people/PeopleBook';
import { need } from './capabilities';
import { connectStorage } from './connectStorage';
import { startJoining, type JoinSettings } from './startJoining';

export interface ConnectOptions {
  /** Connect's own settings (`ConnectSettingsStore`). */
  settings: JoinSettings;
  /** Replaces parts of the hosting deps; tests pass an in-memory host and table. */
  hosting?: Partial<Deps>;
  /** The plugin's player key per GM host, so an Atlas reload keeps them; the join service makes its own without. */
  playerKeys?: (hostId: string) => string;
}

/** Hosting needs the presented scene, the views, the rules, Atlas's settings and a storage folder. */
const HOSTING = ['views', 'presentation', 'rules', 'settings', 'storage'] as const;

function canHost(api: AtlasApi, atlas: AtlasExtension): boolean {
  return HOSTING.every((capability) => need(api, atlas, capability) !== null);
}

/** Hosting online sessions: the session service, its commands, the status bar item and the presentation target. */
async function startHosting(plugin: Plugin, api: AtlasApi, atlas: AtlasExtension, options: ConnectOptions, gone: () => boolean): Promise<Disposer> {
  const paths = await connectStorage(api, atlas);
  // Atlas went (and may be back) while the folder was asked for: a newer setup owns the service and the commands.
  if (!paths || gone()) return () => undefined;
  const people = PeopleBook.forApp(plugin.app, paths);
  const deps: Deps = { ...sessionDeps(atlas, { dice: need(api, atlas, 'dice'), lasers: need(api, atlas, 'lasers'), lighting: need(api, atlas, 'lighting'), tokens: need(api, atlas, 'tokens') }), people, isJoined: () => isInSession(joinedSessionStore.getState()), ...options.hosting };
  const service = new OnlineSessionService(plugin.app, options.settings, deps);
  // Atlas's UI slots (toolbar, palette, menus, panel) when this Atlas has them; the commands and the modal run a session either way.
  const ui = need(api, atlas, 'ui');
  const gmUi = ui ? registerGmUi({ ui, presentation: atlas.presentation, views: atlas.views }, service, { presented: deps.presented, joinSession: () => openJoinSessionModal(plugin.app) }) : undefined;
  const stopOnline = registerOnline(plugin, service, { presentation: atlas.presentation, ...(gmUi ? { gmUi } : {}) });
  return () => {
    gmUi?.();
    stopOnline();
  };
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
  // Joining needs no Atlas map and no capability, so it starts for every Atlas Connect binds to.
  keep(startJoining(plugin, atlas, api, options.settings, options.playerKeys));
  if (canHost(api, atlas)) {
    startHosting(plugin, api, atlas, options, () => disposed).then(keep, (error: unknown) => {
      console.error('[Atlas VTT Connect] Could not start hosting online sessions:', error);
    });
  }
  return () => {
    disposed = true;
    for (const stop of stops.splice(0).reverse()) stop();
  };
}
