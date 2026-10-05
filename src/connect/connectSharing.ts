import type { Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';
import type { OnlineJoinService } from '../app/online/obsidian/OnlineJoinService';
import type { OnlineSessionService } from '../app/online/OnlineSessionService';
import { ShareItems } from '../app/online/sharing/model/ShareItems';
import { PeopleBook } from '../app/online/sharing/people/PeopleBook';
import { registerSharing } from '../app/online/sharing/registerSharing';
import type { SharingLifetime } from '../app/online/sharing/sharingLifetime';
import { need } from './capabilities';
import { connectStorage } from './connectStorage';
import type { JoinSettings } from './startJoining';

/** Shown in Connect's settings while the bound Atlas has no `scenes` or `bundles`. */
export const UPDATE_ATLAS_TO_SHARE = 'Update Atlas VTT to share notes and maps.';

/** Sharing needs Atlas's scenes and bundles, its rules and settings, and a storage folder for Connect's files. */
const SHARING = ['scenes', 'bundles', 'rules', 'settings', 'storage'] as const;

export function canShare(api: AtlasApi, atlas: AtlasExtension): boolean {
  return SHARING.every((capability) => need(api, atlas, capability) !== null);
}

export interface SharingStart {
  joins: OnlineJoinService;
  /** The hosting service once hosting has started; null where this Atlas cannot host. */
  sessions: Promise<OnlineSessionService | null>;
  settings: JoinSettings;
  lifetime: SharingLifetime;
  /** Atlas went (and may be back) while sharing was starting: a newer setup owns the commands. */
  gone(): boolean;
}

/** Starts sharing for this binding (`registerSharing`), once Connect's storage folder is known. */
export async function startConnectSharing(plugin: Plugin, api: AtlasApi, atlas: AtlasExtension, start: SharingStart): Promise<Disposer> {
  const paths = await connectStorage(api, atlas);
  const sessions = await start.sessions;
  if (!paths || start.gone()) return () => undefined;
  return registerSharing(plugin, {
    atlas: { scenes: atlas.scenes, rules: atlas.rules, playerView: () => atlas.settings.get('playerView') },
    lifetime: start.lifetime,
    joins: start.joins,
    people: PeopleBook.forApp(plugin.app, paths),
    items: ShareItems.forApp(plugin.app, paths),
    sessions,
    settings: {
      ownTableId: () => start.settings.get().table?.id ?? null,
      shareableProperties: () => start.settings.get().shareableProperties,
    },
  });
}
