/**
 * Follow GM and Fit map in the remote view's toolbar. Both show only in a remote view Connect opened
 * (`isVisible`, API 1.15): Follow GM is drawn active while the view follows (the fork's showed them only after a
 * break-away). On an Atlas before 1.15 `isVisible` is ignored, so they show in every remote view; each acts only
 * in the view it belongs to, and in another extension's remote view it does nothing.
 */
import type { ToolbarItem, ViewId } from '@atlas-vtt/api-types';

export const FOLLOW_GM_LABEL = 'Follow GM';
export const FIT_MAP_LABEL = 'Fit map';
export const FOLLOW_GM_ITEM = 'online-scene-follow-gm';
export const FIT_MAP_ITEM = 'online-scene-fit-map';
/** Among extensions' items, which sit together after Atlas's dice button: higher sits further left, so Follow GM comes first. */
const PRIORITY = { follow: 60, fit: 59 } as const;

export interface RemoteToolbarControls {
  isFollowing(): boolean;
  followGm(): void;
  fitMap(): void;
}

export function remoteToolbarItems(viewId: ViewId, controls: RemoteToolbarControls): ToolbarItem[] {
  return [
    {
      id: FOLLOW_GM_ITEM, icon: 'locate-fixed', label: FOLLOW_GM_LABEL, priority: PRIORITY.follow, views: ['remote'], isVisible: (ctx) => ctx.ownRemote,
      isActive: (ctx) => ctx.viewId === viewId && controls.isFollowing(),
      onClick: (ctx) => { if (ctx.viewId === viewId) controls.followGm(); },
    },
    {
      id: FIT_MAP_ITEM, icon: 'maximize', label: FIT_MAP_LABEL, priority: PRIORITY.fit, views: ['remote'], isVisible: (ctx) => ctx.ownRemote,
      onClick: (ctx) => { if (ctx.viewId === viewId) controls.fitMap(); },
    },
  ];
}
