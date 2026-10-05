/**
 * Follow GM and Fit map in the remote view's toolbar. The API shows an item in every remote view and cannot hide
 * it, so both always show (the fork's showed them only while the player had broken away): Follow GM is drawn
 * active while the view follows. Each acts only in the view it belongs to; in another extension's remote view
 * it does nothing.
 */
import type { ToolbarItem, ViewId } from '@atlas-vtt/api-types';

export const FOLLOW_GM_LABEL = 'Follow GM';
export const FIT_MAP_LABEL = 'Fit map';
export const FOLLOW_GM_ITEM = 'online-scene-follow-gm';
export const FIT_MAP_ITEM = 'online-scene-fit-map';
/** Among Atlas's own view tools (45 to 100). */
const PRIORITY = { follow: 60, fit: 59 } as const;

export interface RemoteToolbarControls {
  isFollowing(): boolean;
  followGm(): void;
  fitMap(): void;
}

export function remoteToolbarItems(viewId: ViewId, controls: RemoteToolbarControls): ToolbarItem[] {
  return [
    {
      id: FOLLOW_GM_ITEM, icon: 'locate-fixed', label: FOLLOW_GM_LABEL, priority: PRIORITY.follow, views: ['remote'],
      isActive: (ctx) => ctx.viewId === viewId && controls.isFollowing(),
      onClick: (ctx) => { if (ctx.viewId === viewId) controls.followGm(); },
    },
    {
      id: FIT_MAP_ITEM, icon: 'maximize', label: FIT_MAP_LABEL, priority: PRIORITY.fit, views: ['remote'],
      onClick: (ctx) => { if (ctx.viewId === viewId) controls.fitMap(); },
    },
  ];
}
