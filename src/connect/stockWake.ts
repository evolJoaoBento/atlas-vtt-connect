/**
 * Atlas's map tab, woken when online play needs it. After Obsidian restarts, a tab not shown yet is a deferred leaf: its
 * view is a placeholder with no stores until it is shown, so Connect has no scene to send, and a GM who works only on
 * Tabletop's 3D board never shows it. Players would wait for a scene for good. Connect loads such a leaf itself
 * (`loadIfDeferred`, Obsidian 1.7.2) when it hosts, presents or admits a player, without moving the GM off their tab.
 */
import type { App, WorkspaceLeaf } from 'obsidian';
import type { Disposer } from '@atlas-vtt/api-types';

interface MaybeDeferred {
  isDeferred?: boolean;
  loadIfDeferred?: () => Promise<void>;
}

/**
 * Loads every deferred leaf of `viewType`; true when one was. The leaf the GM is on stays theirs: loading shows nothing,
 * and should Obsidian make the loaded leaf active anyway, the GM's leaf is made active again, without focus moving.
 */
export async function loadDeferredLeaves(app: App, viewType: string): Promise<boolean> {
  const deferred = app.workspace.getLeavesOfType(viewType).filter((leaf) => {
    const maybe = leaf as unknown as MaybeDeferred;
    return maybe.isDeferred === true && typeof maybe.loadIfDeferred === 'function';
  });
  if (deferred.length === 0) return false;
  const before: WorkspaceLeaf | null = app.workspace.getMostRecentLeaf?.() ?? null;
  let loaded = false;
  for (const leaf of deferred) {
    try {
      await (leaf as unknown as Required<MaybeDeferred>).loadIfDeferred();
      loaded = true;
    } catch (error) {
      console.error('[Atlas VTT Connect] Could not load Atlas\'s map tab:', error);
    }
  }
  const after = app.workspace.getMostRecentLeaf?.() ?? null;
  if (before && after !== before && deferred.includes(after as WorkspaceLeaf)) app.workspace.setActiveLeaf(before, { focus: false });
  return loaded;
}

export interface HostingWakeDeps {
  /** The online session's status and players, as the store has them. */
  state(): { status: string; players: readonly { status: string }[] };
  subscribe(listener: () => void): Disposer;
  /** Loads Atlas's deferred map tabs (`loadDeferredLeaves`); true when one was. */
  wake(): Promise<boolean>;
  /** Whether Atlas has a map view whose map is loaded. */
  hasLoadedView(): boolean;
  /**
   * Makes sure players have a scene: the presented one (Atlas keeps it across restarts) when its tab is not the one
   * loaded, else the GM's tab when nothing is presented.
   */
  ensurePresented(): Promise<void>;
  /** Waits up to `ms` for a loaded view; true once there is one. */
  waitForLoadedView(ms: number): Promise<boolean>;
}

/** How long a woken tab may take to load its map before Start online session stops waiting to present it. */
export const WAKE_LOAD_MS = 15_000;

/**
 * Wakes Atlas's tab when online play starts hosting, and when a player is admitted while no map view is loaded. Once
 * a tab woken for hosting has loaded, it makes sure a scene is presented (`ensurePresented`), so players who join see it.
 */
export function wakeAtlasForHosting(deps: HostingWakeDeps): Disposer {
  let hosting = false;
  let admitted = 0;
  let run = 0;
  const startHosting = async (current: number): Promise<void> => {
    // Only a tab woken here: a view the GM already had keeps the scene they chose (or none).
    if (!(await deps.wake())) return;
    if (current !== run || !(await deps.waitForLoadedView(WAKE_LOAD_MS)) || current !== run) return;
    await deps.ensurePresented();
  };
  const listener = (): void => {
    const { status, players } = deps.state();
    const now = status === 'hosting';
    const nowAdmitted = players.filter((player) => player.status === 'admitted').length;
    if (now && !hosting) {
      run += 1;
      void startHosting(run).catch((error: unknown) => console.error('[Atlas VTT Connect] Could not show Atlas\'s map for online play:', error));
    } else if (now && nowAdmitted > admitted && !deps.hasLoadedView()) {
      // A player came in and there is still no scene to send them: wake the tab again (closed and restored meanwhile).
      void deps.wake().catch(() => undefined);
    }
    if (!now) run += 1;
    hosting = now;
    admitted = now ? nowAdmitted : 0;
  };
  listener();
  return deps.subscribe(listener);
}
