import type { Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';
import { OnlineJoinService } from '../app/online/obsidian/OnlineJoinService';
import { openJoinSessionModal } from '../app/online/obsidian/ui/JoinSessionModal';
import { joinSessionTile } from '../app/online/obsidian/ui/joinSessionTile';
import { openSceneTab } from '../app/online/obsidian/sceneTabs';
import type { ConnectSettingsStore } from './settingsStore';
import { JOIN_SESSION_LABEL } from '../app/online/ui/onlineCopy';
import { need } from './capabilities';

export type JoinSettings = Pick<ConnectSettingsStore, 'get' | 'set' | 'onChange'>;

const JOIN_COMMAND = 'join-online-session';

/**
 * Joining sessions from Obsidian: the join service, the "Join online session…" command and, when this Atlas has
 * `ui`, the dashboard tile. Joining needs no Atlas map and no hosting capability, so this runs for every Atlas
 * Connect binds to; it stops with the binding (an Atlas reload ends a joined session).
 */
export function startJoining(plugin: Plugin, atlas: AtlasExtension, api: AtlasApi, settings: JoinSettings): Disposer {
  const { app } = plugin;
  const service = new OnlineJoinService(app, settings, plugin.manifest.version, {
    openSceneTab: () => openSceneTab(app),
  });
  plugin.addCommand({ id: JOIN_COMMAND, name: JOIN_SESSION_LABEL, callback: () => openJoinSessionModal(app) });
  const stopTile = need(api, atlas, 'ui')?.addDashboardTile(joinSessionTile(app));
  return () => {
    stopTile?.();
    plugin.removeCommand(JOIN_COMMAND);
    service.dispose();
  };
}
