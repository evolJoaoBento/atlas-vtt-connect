import type { Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';
import { sessionDeps } from '../app/online/atlas/sessionDeps';
import { isInSession, joinedSessionStore } from '../app/online/obsidian/joinedSessionStore';
import { openJoinSessionModal } from '../app/online/obsidian/ui/JoinSessionModal';
import { OnlineSessionService, type Deps } from '../app/online/OnlineSessionService';
import { registerGmUi } from '../app/online/gm-ui/registerGmUi';
import { registerOnline } from '../app/online/registerOnline';
import { SHARE_PROPERTY } from '../app/online/sharing/model/shareRule';
import { PeopleBook } from '../app/online/sharing/people/PeopleBook';
import type { SharingLifetime } from '../app/online/sharing/sharingLifetime';
import { need } from './capabilities';
import { canShare, startConnectSharing } from './connectSharing';
import { connectStorage } from './connectStorage';
import type { MigrationSettings } from './migrateFromFork';
import { startMigration, type MigrationStart } from './startMigration';
import { startJoining, type JoinSettings } from './startJoining';

export interface ConnectOptions {
  /** Connect's own settings (`ConnectSettingsStore`). */
  settings: JoinSettings;
  /** Replaces parts of the hosting deps; tests pass an in-memory host and table. */
  hosting?: Partial<Deps>;
  /** The plugin's player key per GM host, so an Atlas reload keeps them; the join service makes its own without. */
  playerKeys?: (hostId: string) => string;
  /** What sharing hears for the plugin's lifetime (`sharingLifetime`, made in `onload`). */
  lifetime: SharingLifetime;
  /** Told whether the bound Atlas can share notes and maps (the settings tab says so when it cannot); null once it is gone. */
  sharing?: (available: boolean | null) => void;
  /** The store the fork's data is brought into (`ConnectSettingsStore`); without it nothing is migrated. */
  migration?: MigrationSettings;
  /** Replaces the migration's notices and image caches; tests pass their own. */
  migrationStart?: MigrationStart;
}

/** Hosting needs the presented scene, the views, the rules, Atlas's settings and a storage folder. */
const HOSTING = ['views', 'presentation', 'rules', 'settings', 'storage'] as const;

function canHost(api: AtlasApi, atlas: AtlasExtension): boolean {
  return HOSTING.every((capability) => need(api, atlas, capability) !== null);
}

interface Hosting {
  service: OnlineSessionService | null;
  stop: Disposer;
}

/** Hosting online sessions: the session service, its commands, the status bar item and the presentation target. */
async function startHosting(plugin: Plugin, api: AtlasApi, atlas: AtlasExtension, options: ConnectOptions, gone: () => boolean): Promise<Hosting> {
  const paths = await connectStorage(api, atlas);
  // Atlas went (and may be back) while the folder was asked for: a newer setup owns the service and the commands.
  if (!paths || gone()) return { service: null, stop: () => undefined };
  const people = PeopleBook.forApp(plugin.app, paths);
  const deps: Deps = { ...sessionDeps(atlas, { dice: need(api, atlas, 'dice'), lasers: need(api, atlas, 'lasers'), lighting: need(api, atlas, 'lighting'), tokens: need(api, atlas, 'tokens') }), people, isJoined: () => isInSession(joinedSessionStore.getState()), ...options.hosting };
  const service = new OnlineSessionService(plugin.app, options.settings, deps);
  // Atlas's UI slots (toolbar, palette, menus, panel) when this Atlas has them; the commands and the modal run a session either way.
  const ui = need(api, atlas, 'ui');
  const gmUi = ui ? registerGmUi({ ui, presentation: atlas.presentation, views: atlas.views }, service, { presented: deps.presented, joinSession: () => openJoinSessionModal(plugin.app) }) : undefined;
  const stopOnline = registerOnline(plugin, service, { presentation: atlas.presentation, ...(gmUi ? { gmUi } : {}) });
  return {
    service,
    stop: () => {
      gmUi?.();
      stopOnline();
    },
  };
}

/** Starts every Connect feature this Atlas supports; the returned disposer stops them all (Atlas unloaded or Connect unloading). */
export function startConnect(plugin: Plugin, atlas: AtlasExtension, api: AtlasApi, options: ConnectOptions): Disposer {
  const stops: Disposer[] = [];
  let disposed = false;
  const gone = (): boolean => disposed;
  const keep = (stop: Disposer): void => {
    // Atlas may have gone while a feature was still starting: it stops at once.
    if (disposed) stop();
    else stops.push(stop);
  };
  // Sharing never travels in bundles: as soon as this Atlas can strip note properties, `atlas-share` is stripped from
  // exports and installs, whatever else Connect can start. Atlas remembers the key, so it stays stripped while Connect
  // is not loaded; the disposer would make Atlas forget it, so it is never called (ruling I5).
  need(api, atlas, 'bundles')?.stripNoteProperties([SHARE_PROPERTY]);
  // The fork's device keys are brought over before joining can make new ones; hosting and sharing wait for the rest.
  const migrated = startMigration(plugin.app, api, atlas, options.migration, options.migrationStart);
  // Joining needs no Atlas map and no capability, so it starts for every Atlas Connect binds to.
  const joining = startJoining(plugin, atlas, api, options.settings, options.playerKeys);
  keep(joining.stop);
  let sessions: Promise<OnlineSessionService | null> = Promise.resolve(null);
  if (canHost(api, atlas)) {
    const hosting = migrated.then((ok) => (ok ? startHosting(plugin, api, atlas, options, gone) : { service: null, stop: () => undefined }));
    sessions = hosting.then((started) => {
      keep(started.stop);
      return started.service;
    }, (error: unknown) => {
      console.error('[Atlas VTT Connect] Could not start hosting online sessions:', error);
      return null;
    });
  }
  const sharing = canShare(api, atlas);
  options.sharing?.(sharing);
  if (sharing) {
    const start = { joins: joining.service, sessions, settings: options.settings, lifetime: options.lifetime, gone };
    migrated.then((ok) => (ok ? startConnectSharing(plugin, api, atlas, start) : () => undefined)).then(keep, (error: unknown) => {
      console.error('[Atlas VTT Connect] Could not start sharing notes and maps:', error);
    });
  }
  return () => {
    disposed = true;
    for (const stop of stops.splice(0).reverse()) stop();
    options.sharing?.(null);
  };
}
