/**
 * The GM's online play in Atlas's UI slots (API `ui`): the toolbar button, the palette section, the view menu items,
 * the token menu's "Controlled by" and the panel. Without the `ui` capability none of it exists, and the commands, the
 * status bar item and the modal run a session instead (`registerOnline`).
 */
import type { App } from 'obsidian';
import type { AtlasExtension, Disposer, PanelHandle, ViewContext } from '@atlas-vtt/api-types';
import type { PresentedSceneSource } from '../atlas/presentedSource';
import type { OnlineSessionService } from '../OnlineSessionService';
import { onlineSessionStore } from '../onlineSessionStore';
import { ONLINE_SESSION_LABEL, PRESENT_LABEL, STOP_PRESENTING_LABEL } from '../ui/onlineCopy';
import { presentedSceneSummaries } from '../ui/presentedSceneSummary';
import { controlledByProvider } from './controlledByMenu';
import { mountPanel } from './mountPanel';
import { onlinePaletteSection, presentingActions } from './onlinePalette';
import { onlineToolbarItem } from './onlineToolbar';
import { revealView } from './revealView';
import type { PanelService } from './OnlinePanel';

type GmUiAtlas = Pick<AtlasExtension, 'ui' | 'presentation' | 'views'>;

export interface GmUiOptions {
  /** The presented scene online play already reads (`sessionDeps`), so the panel shows the same presentation. */
  presented: PresentedSceneSource;
  /** Opens "Join online session…" (joining comes with plan B12); without it the panel offers no join. */
  joinSession?: () => void;
}

/** What `registerGmUi` hands back: the disposer, and the way "Online session…" opens the panel. */
export type GmUi = Disposer & {
  /** Opens the panel in the active GM map view, else the first one open; false when there is none, so the modal is used. */
  openPanel(app: App): boolean;
};

export function registerGmUi(atlas: GmUiAtlas, service: PanelService & Pick<OnlineSessionService, 'stop'>, options: GmUiOptions): GmUi {
  const { ui, presentation, views } = atlas;
  const summaries = presentedSceneSummaries(options.presented, views);
  let disposed = false;
  const invalidate = (): void => { if (!disposed) ui.invalidate(); };
  /** The views that drew GM slots: only they can show the panel (a player window draws none). */
  const gmViews = new Set<string>();
  const seen = (ctx: ViewContext): void => { if (!ctx.isPlayerView) gmViews.add(ctx.viewId); };

  const env = { service, summaries, presentation, views, ...(options.joinSession ? { joinSession: options.joinSession } : {}) };
  const panel: PanelHandle = ui.addPanel({ id: 'online', title: ONLINE_SESSION_LABEL, mount: (container, ctx) => mountPanel(env, container, ctx) });
  const stops: Disposer[] = [
    ui.addToolbarItem(onlineToolbarItem({ panel, session: () => onlineSessionStore.getState(), seen })),
    ui.addPaletteSection(onlinePaletteSection({ service, panel, presentation, views, seen })),
    ui.addViewMenuItems((ctx) => {
      seen(ctx);
      const { present, stop } = presentingActions({ presentation, views }, ctx);
      return [
        { label: `${ONLINE_SESSION_LABEL}…`, icon: 'network', onClick: () => panel.open(ctx.viewId) },
        ...(present ? [{ label: PRESENT_LABEL, icon: 'cast', onClick: () => { void presentation.present(ctx.viewId); } }] : []),
        ...(stop ? [{ label: STOP_PRESENTING_LABEL, icon: 'square', onClick: () => presentation.stop() }] : []),
      ];
    }),
    ui.addTokenMenuItems(controlledByProvider()),
    () => panel.dispose(),
  ];

  // Atlas reads the slots again after every change of the session, of who controls which token, and of what is presented.
  let stopControl: Disposer | null = null;
  const watchControl = (): void => {
    stopControl?.();
    stopControl = onlineSessionStore.getState().tokenControl?.onChange(invalidate) ?? null;
  };
  watchControl();
  const stopStore = onlineSessionStore.subscribe((state, before) => {
    if (state.tokenControl !== before.tokenControl) watchControl();
    invalidate();
  });
  const stopPresentation = presentation.subscribe({ presented: invalidate, held: invalidate, cleared: invalidate });

  const stop = (): void => {
    if (disposed) return;
    disposed = true;
    stopStore();
    stopPresentation();
    stopControl?.();
    for (const dispose of stops.splice(0).reverse()) dispose();
  };
  const openPanel = (app: App): boolean => {
    const active = views.active();
    const open = views.list().filter((view) => view.kind === 'map' && gmViews.has(view.viewId));
    const target = active && gmViews.has(active.viewId) ? active : open[0];
    if (!target) return false;
    panel.open(target.viewId);
    if (!panel.isOpen(target.viewId)) return false;
    if (target.viewId !== active?.viewId) revealView(app, target.viewId);
    invalidate();
    return true;
  };
  return Object.assign(stop, { openPanel });
}
