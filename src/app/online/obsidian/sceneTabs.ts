import type { App } from 'obsidian';
import type { AtlasApi, AtlasExtension, RemoteView } from '@atlas-vtt/api-types';
import { need } from '../../../connect/capabilities';
import { openSharedFromView } from '../sharing/sharedFromView';
import { LASER_PALETTE } from '../tools/laserColors';
import { DICE_LIMITS } from '../tools/toolMessages';
import { OnlineJoinService } from './OnlineJoinService';
import { ONLINE_SCENE_TITLE, openOnlineSceneTab } from './onlineSceneTab';
import { RemoteSceneClient } from './remote/RemoteSceneClient';

/** The remote views a client shows the session in; `reuse` may hand back one already attached. */
const attached = new WeakSet<RemoteView>();

/** The player's Atlas laser colour; the first swatch where Atlas has no settings. */
function laserColorOf(api: AtlasApi, atlas: AtlasExtension): () => string {
  const settings = need(api, atlas, 'settings');
  return () => settings?.get('laserPointer').color ?? LASER_PALETTE[0]!;
}

/** Shows the joined session in `view`; false when there was nothing to show, and the view is closed. */
function attachRemoteScene(app: App, api: AtlasApi, atlas: AtlasExtension, view: RemoteView): boolean {
  if (attached.has(view)) return true;
  const service = OnlineJoinService.forApp(app);
  const client = service ? new RemoteSceneClient({
    view, service, lasers: need(api, atlas, 'lasers'), ui: need(api, atlas, 'ui'), laserColor: laserColorOf(api, atlas),
    openShared: () => openSharedFromView(app),
  }) : null;
  if (!client?.attach()) {
    client?.dispose();
    view.close();
    return false;
  }
  attached.add(view);
  return true;
}

/**
 * Opens the tab that shows the joined session: Atlas's own remote view (API 1.12) when this Atlas has the
 * `remote-view` capability, drawn by Atlas with the player's tools and dice. On every other Atlas, or when the
 * remote view cannot open, the tab is Connect's own Canvas 2D scene (`CanvasSceneView`).
 */
export async function openSceneTab(app: App, api: AtlasApi, atlas: AtlasExtension): Promise<void> {
  const remoteViews = api.has('remote-view') ? atlas.remoteViews : undefined;
  if (!remoteViews) return openOnlineSceneTab(app);
  let view: RemoteView;
  try {
    view = await remoteViews.open({ title: ONLINE_SCENE_TITLE, icon: 'network', reuse: true, maxDice: DICE_LIMITS.dicePerRoll });
  } catch (error) {
    console.error('[Atlas VTT Connect] The remote view did not open; showing the Canvas scene:', error);
    return openOnlineSceneTab(app);
  }
  attachRemoteScene(app, api, atlas, view);
}
