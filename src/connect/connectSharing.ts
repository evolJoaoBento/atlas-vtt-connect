import type { Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';
import type { OnlineJoinService } from '../app/online/obsidian/OnlineJoinService';
import type { OnlineSessionService } from '../app/online/OnlineSessionService';
import { MergeHistory } from '../app/online/sharing/merge/MergeHistory';
import { ShareItems } from '../app/online/sharing/model/ShareItems';
import { PeopleBook } from '../app/online/sharing/people/PeopleBook';
import { PulledItems } from '../app/online/sharing/receive/PulledItems';
import { registerSharing } from '../app/online/sharing/registerSharing';
import type { SharingLifetime } from '../app/online/sharing/sharingLifetime';
import { need } from './capabilities';
import { NO_SCENES } from '../app/online/sharing/noScenes';
import { connectStorage } from './connectStorage';
import type { JoinSettings } from './startJoining';

/** Shown in Connect's settings while the bound Atlas cannot share at all. */
export const UPDATE_ATLAS_TO_SHARE = 'Update Atlas VTT to share notes and maps.';

/**
 * Sharing notes needs Atlas's rules and settings and a storage folder for Connect's files, which a stock Atlas has too.
 * Maps also need its `scenes`: without them (`NO_SCENES`) only notes are shared.
 */
const SHARING = ['rules', 'settings', 'storage'] as const;

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
  const views = need(api, atlas, 'views');
  const scenes = need(api, atlas, 'scenes');
  return registerSharing(plugin, {
    atlas: { scenes: scenes ?? NO_SCENES, maps: scenes !== null, rules: atlas.rules, playerView: () => atlas.settings.get('playerView'), ...(views ? { views } : {}) },
    lifetime: start.lifetime,
    joins: start.joins,
    people: PeopleBook.forApp(plugin.app, paths),
    items: ShareItems.forApp(plugin.app, paths),
    pulled: PulledItems.forApp(plugin.app, paths),
    history: new MergeHistory(plugin.app.vault.adapter, paths.history),
    sessions,
    settings: {
      ownTableId: () => start.settings.get().table?.id ?? null,
      shareableProperties: () => start.settings.get().shareableProperties,
    },
  });
}
