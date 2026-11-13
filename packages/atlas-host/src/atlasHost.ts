/**
 * The one Atlas view both plugins edit through. Stock Atlas 0.15 keeps a single Atlas leaf holding one map at a time
 * (extra Atlas leaves are folded into it as scene tabs), and its rules and saving live in that view's store. So every
 * edit goes through that store, and the store is made to hold the map of the board the GM works on (`follow`). A map
 * the host does not hold is not edited: nothing here, and nothing built on it, writes a map file.
 */
import type { App, EventRef, TAbstractFile, TFile, WorkspaceLeaf } from 'obsidian';
import { ATLAS_VIEW_TYPE, openBackgroundLeaf } from './hostLeaf';

/** How long the host may take to hold a map it was asked for. */
export const HOST_LOAD_MS = 15_000;
/** Property on the Atlas leaf, shared by both plugins' copies of this file: who opened it and who needs it. */
export const HOST_MARK = '__atlasFusionHost';

export interface HostMark {
  /** The plugin that opened the leaf for hosting; null when the user (or Atlas) opened it. */
  openedBy: string | null;
  /** Plugin id to the number of boards or sessions of it that need the host. */
  claims: Map<string, number>;
}
export interface HostState {
  mapPath: string | null;
  mapLoaded?: boolean;
  isMapLoading?: boolean;
  remoteView?: unknown;
  [key: string]: unknown;
}
export interface HostStore {
  getState(): HostState;
  subscribe(listener: () => void): () => void;
}
export type HostStatus = { kind: 'none' } | { kind: 'loading'; mapPath: string | null } | { kind: 'held'; mapPath: string };
export type FollowResult = 'held' | 'timeout' | 'no-atlas' | 'no-file' | 'superseded';

interface HostView {
  atlasStore: HostStore;
  tabMetaStore: { getState(): { tabs: ReadonlyArray<{ id: string; filePath: string }> } };
  switchToTab(id: string): Promise<void>;
  onLoadFile(file: TFile): Promise<void>;
  file?: { path: string } | null;
}
type MaybeDeferred = WorkspaceLeaf & { isDeferred?: boolean; loadIfDeferred?: () => Promise<void> };
type Marked = WorkspaceLeaf & { [HOST_MARK]?: HostMark };
interface Waiter {
  mapPath: string;
  resolve(store: HostStore | null): void;
}

const isHeld = (state: HostState, mapPath: string): boolean => state.mapPath === mapPath && state.mapLoaded !== false && state.isMapLoading !== true;
const viewOf = (leaf: WorkspaceLeaf): HostView | null => {
  const view = leaf.view as unknown as Partial<HostView> | null;
  if (!view?.atlasStore || !view.tabMetaStore || typeof view.switchToTab !== 'function' || typeof view.onLoadFile !== 'function') return null;
  return view.atlasStore.getState().remoteView ? null : (view as HostView);
};
const isFile = (file: TAbstractFile | null): file is TFile => file !== null && typeof (file as Partial<TFile>).extension === 'string';

export class AtlasHost {
  private readonly pluginId: string;
  private readonly wait: (ms: number) => Promise<void>;
  private readonly listeners = new Set<() => void>();
  private readonly layoutRef: EventRef;
  private leaf: WorkspaceLeaf | null = null;
  private unsubscribe: (() => void) | null = null;
  private claims = 0;
  private closed = false;
  private detaching = false;
  private run = 0;
  private inFlight: { mapPath: string; promise: Promise<FollowResult> } | null = null;
  private waiters: Waiter[] = [];
  private lastKey = '';

  constructor(private readonly app: App, options: { pluginId: string; wait?: (ms: number) => Promise<void> }) {
    this.pluginId = options.pluginId;
    this.wait = options.wait ?? ((ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); }));
    this.layoutRef = app.workspace.on('layout-change', () => this.bind());
    this.bind();
  }

  /** The Atlas leaf, loaded or deferred: the first in the workspace, as Atlas keeps one. */
  private hostLeaf(): WorkspaceLeaf | null {
    const leaves = this.app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE);
    return leaves.find((leaf) => viewOf(leaf) !== null) ?? leaves.find((leaf) => (leaf as MaybeDeferred).isDeferred === true) ?? null;
  }
  private view(): HostView | null {
    const leaf = this.hostLeaf();
    return leaf ? viewOf(leaf) : null;
  }

  status(): HostStatus {
    const view = this.view();
    if (!view) return { kind: 'none' };
    const state = view.atlasStore.getState();
    return state.mapPath !== null && isHeld(state, state.mapPath) ? { kind: 'held', mapPath: state.mapPath } : { kind: 'loading', mapPath: view.file?.path ?? state.mapPath };
  }

  holds(mapPath: string): boolean {
    const view = this.view();
    return view !== null && isHeld(view.atlasStore.getState(), mapPath);
  }

  /** The host's store while it holds `mapPath`; else null. */
  store(mapPath: string): HostStore | null {
    const view = this.view();
    return view !== null && isHeld(view.atlasStore.getState(), mapPath) ? view.atlasStore : null;
  }

  /** Whether the host is on its way to `mapPath`: a follow of it runs, or the view loads it. */
  private underWay(mapPath: string): boolean {
    if (this.inFlight?.mapPath === mapPath) return true;
    const view = this.view();
    return view !== null && view.file?.path === mapPath && view.atlasStore.getState().isMapLoading === true;
  }

  /**
   * Makes the host hold `mapPath`, the `front` leaf staying in front: a scene tab the view already has is switched to;
   * a deferred Atlas leaf is loaded; a view without the map loads it as a new scene tab (`onLoadFile`, Atlas's own way,
   * gate G6b); and with no Atlas leaf at all one is opened behind `front`. A follow of the same map joins the one
   * running; a follow of another map supersedes it.
   */
  follow(mapPath: string, front: WorkspaceLeaf): Promise<FollowResult> {
    if (this.holds(mapPath)) {
      this.setClosed(false);
      return Promise.resolve('held');
    }
    if (this.inFlight?.mapPath === mapPath) return this.inFlight.promise;
    const run = ++this.run;
    // Recorded before the work starts: opening the leaf makes the front active again, which a board answers with a
    // follow of its own, and that one must join this one.
    let settle: (result: FollowResult) => void = () => undefined;
    const promise = new Promise<FollowResult>((resolve) => { settle = resolve; });
    this.inFlight = { mapPath, promise };
    this.changed();
    void this.go(mapPath, front, run)
      .catch((error: unknown): FollowResult => {
        console.error('[Atlas host] Could not make Atlas hold the map:', error);
        return 'timeout';
      })
      .then((result) => {
        if (this.inFlight?.promise === promise) this.inFlight = null;
        settle(result);
        this.changed();
      });
    return promise;
  }

  private async go(mapPath: string, front: WorkspaceLeaf, run: number): Promise<FollowResult> {
    const file = this.app.vault.getAbstractFileByPath(mapPath);
    if (!isFile(file)) return 'no-file';
    if (!(this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.[ATLAS_VIEW_TYPE]) return 'no-atlas';
    this.setClosed(false);
    let view = this.view();
    if (!view) {
      const deferred = this.app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE).find((leaf) => (leaf as MaybeDeferred).isDeferred === true) as MaybeDeferred | undefined;
      if (deferred?.loadIfDeferred) {
        await deferred.loadIfDeferred();
        this.keepFront(front);
        this.bind();
        view = this.view();
      }
    }
    if (run !== this.run) return 'superseded';
    if (view) {
      const state = view.atlasStore.getState();
      const headed = view.file?.path === mapPath && (state.isMapLoading === true || state.mapPath === mapPath);
      if (!headed) {
        const tab = view.tabMetaStore.getState().tabs.find((each) => each.filePath === mapPath);
        if (tab) await view.switchToTab(tab.id);
        else await view.onLoadFile(file);
      }
    } else {
      const existed = this.app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE).length > 0;
      const leaf = await openBackgroundLeaf(this.app, file, front);
      if (!existed) this.markOf(leaf).openedBy ??= this.pluginId;
    }
    this.keepFront(front);
    this.bind();
    if (run !== this.run) return 'superseded';
    return this.untilHeld(mapPath, run);
  }

  /** Should the Atlas leaf have taken the front (a merge of leaves reveals it), the front leaf is made active again. */
  private keepFront(front: WorkspaceLeaf): void {
    const { workspace } = this.app;
    const active = (workspace as unknown as { activeLeaf?: WorkspaceLeaf | null }).activeLeaf ?? null;
    if (active !== front && active !== null && active === this.hostLeaf()) workspace.setActiveLeaf(front, { focus: true });
  }

  private untilHeld(mapPath: string, run: number): Promise<FollowResult> {
    return new Promise<FollowResult>((resolve) => {
      let done = false;
      const finish = (result: FollowResult): void => {
        if (done) return;
        done = true;
        stop();
        resolve(result);
      };
      const check = (): void => {
        if (run !== this.run) finish('superseded');
        else if (this.holds(mapPath)) finish('held');
      };
      const stop = this.onChange(check);
      void this.wait(HOST_LOAD_MS).then(() => finish(run !== this.run ? 'superseded' : this.holds(mapPath) ? 'held' : 'timeout'));
      check();
    });
  }

  /**
   * The store at once when held. While a follow or load of `mapPath` is under way: waits, resolving in call order.
   * null when nothing is under way, the host ends on another map, it closes, or `HOST_LOAD_MS` passes.
   */
  whenHeld(mapPath: string): Promise<HostStore | null> {
    const store = this.store(mapPath);
    if (store) return Promise.resolve(store);
    if (!this.underWay(mapPath)) return Promise.resolve(null);
    return new Promise<HostStore | null>((resolve) => {
      const waiter: Waiter = { mapPath, resolve };
      this.waiters.push(waiter);
      void this.wait(HOST_LOAD_MS).then(() => {
        const index = this.waiters.indexOf(waiter);
        if (index < 0) return;
        this.waiters.splice(index, 1);
        resolve(this.store(mapPath));
      });
    });
  }

  /** Answers, in call order, every waiter whose map is now held or no longer on its way. */
  private settle(): void {
    if (this.waiters.length === 0) return;
    const waiting = this.waiters;
    this.waiters = [];
    for (const waiter of waiting) {
      const store = this.store(waiter.mapPath);
      if (store) waiter.resolve(store);
      else if (!this.underWay(waiter.mapPath)) waiter.resolve(null);
      else this.waiters.push(waiter);
    }
  }

  private markOf(leaf: WorkspaceLeaf): HostMark {
    const marked = leaf as Marked;
    return (marked[HOST_MARK] ??= { openedBy: null, claims: new Map() });
  }

  /**
   * Records that a board or session of this plugin needs the host. The release detaches the Atlas leaf when a plugin
   * opened it for hosting and no claim of any plugin is left; a leaf the user opened is never detached.
   */
  claim(): () => void {
    this.claims += 1;
    this.syncClaims();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.claims -= 1;
      this.syncClaims();
      const leaf = this.leaf;
      if (!leaf) return;
      const mark = this.markOf(leaf);
      if (mark.openedBy === null || [...mark.claims.values()].some((count) => count > 0)) return;
      this.detaching = true;
      try { leaf.detach(); } finally { this.detaching = false; }
      this.bind();
    };
  }

  private syncClaims(): void {
    if (!this.leaf) return;
    const mark = this.markOf(this.leaf);
    if (this.claims > 0) mark.claims.set(this.pluginId, this.claims);
    else mark.claims.delete(this.pluginId);
  }

  /** The leaf was detached while claimed, and not by a release. Cleared by the next follow. */
  closedByUser(): boolean {
    return this.closed;
  }
  private setClosed(closed: boolean): void {
    if (this.closed === closed) return;
    this.closed = closed;
    this.changed();
  }

  /** Follows the workspace: the Atlas leaf may have been opened, closed, merged or loaded since. */
  private bind(): void {
    const leaf = this.hostLeaf();
    if (leaf !== this.leaf) {
      const gone = this.leaf !== null && !this.app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE).includes(this.leaf);
      if (gone && leaf === null && this.claims > 0 && !this.detaching) this.closed = true;
      this.leaf = leaf;
      this.syncClaims();
    }
    const store = leaf ? viewOf(leaf)?.atlasStore ?? null : null;
    this.unsubscribe?.();
    this.unsubscribe = store ? store.subscribe(() => this.changed()) : null;
    this.changed();
  }

  private changed(): void {
    this.settle();
    const status = this.status();
    const key = `${status.kind}:${status.kind === 'none' ? '' : status.mapPath}:${this.closed}:${this.inFlight?.mapPath ?? ''}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    for (const listener of [...this.listeners]) listener();
  }

  /** Hears every change of `status()` and `closedByUser()`. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.app.workspace.offref(this.layoutRef);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.run += 1;
    this.listeners.clear();
    for (const waiter of this.waiters.splice(0)) waiter.resolve(null);
  }
}
