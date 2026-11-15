/**
 * A workspace that behaves as Obsidian's does around stock Atlas 0.15, as far as `packages/atlas-host` can tell: one
 * Atlas view with scene tabs sharing one store, leaves that may be deferred, tab groups in the main window or a popout,
 * and Atlas taking the front when its view is set on a leaf unless another leaf was made active first (gate G6).
 */
import type { App, WorkspaceLeaf } from 'obsidian';

export interface FakeHostState {
  mapPath: string | null;
  mapLoaded: boolean;
  isMapLoading: boolean;
}

export class FakeStore {
  private state: FakeHostState = { mapPath: null, mapLoaded: false, isMapLoading: false };
  private readonly listeners = new Set<() => void>();
  getState = (): FakeHostState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  set(next: Partial<FakeHostState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
  }
}

export class FakeAtlasView {
  readonly atlasStore = new FakeStore();
  file: { path: string } | null = null;
  tabs: Array<{ id: string; filePath: string }> = [];
  readonly tabMetaStore = { getState: () => ({ tabs: this.tabs }) };
  constructor(private readonly log: string[]) {}
  /** Starts loading `path`; the test finishes it with `loaded()`. */
  private begin(path: string): void {
    this.file = { path };
    this.atlasStore.set({ isMapLoading: true });
  }
  switchToTab = async (id: string): Promise<void> => {
    const tab = this.tabs.find((each) => each.id === id);
    this.log.push(`switchToTab(${tab?.filePath})`);
    if (tab) this.begin(tab.filePath);
  };
  onLoadFile = async (file: { path: string }): Promise<void> => {
    this.log.push(`onLoadFile(${file.path})`);
    if (!this.tabs.some((tab) => tab.filePath === file.path)) this.tabs.push({ id: `tab${this.tabs.length + 1}`, filePath: file.path });
    this.begin(file.path);
  };
  /** The map the view was loading is now loaded. */
  loaded(): void {
    this.atlasStore.set({ mapPath: this.file?.path ?? null, mapLoaded: true, isMapLoading: false });
  }
}

export class FakeGroup {
  children: FakeLeaf[] = [];
  constructor(readonly root: object) {}
}

export class FakeLeaf {
  view: unknown = { getViewType: () => 'empty' };
  type = 'empty';
  isDeferred = false;
  deferredFile: string | null = null;
  constructor(private readonly workspace: FakeWorkspace, public parent: FakeGroup) {}
  getRoot = (): object => this.parent.root;
  getViewState = (): { type: string } => ({ type: this.type });
  setViewState = async (state: { type: string; state?: { file?: string } }): Promise<void> => {
    this.workspace.log.push(`setViewState(${state.type})`);
    this.type = state.type;
    if (state.type !== 'atlas-vtt') return;
    const view = new FakeAtlasView(this.workspace.log);
    this.view = view;
    if (state.state?.file) await view.onLoadFile({ path: state.state.file });
    // Atlas takes the front unless a leaf was made active between the leaf's creation and this call.
    if (!this.workspace.activatedSince(this)) this.workspace.activeLeaf = this;
    this.workspace.fire('layout-change');
  };
  loadIfDeferred = async (): Promise<void> => {
    if (!this.isDeferred) return;
    this.workspace.log.push('loadIfDeferred');
    this.isDeferred = false;
    const view = new FakeAtlasView(this.workspace.log);
    this.view = view;
    if (this.deferredFile) await view.onLoadFile({ path: this.deferredFile });
    this.workspace.fire('layout-change');
  };
  detach = (): void => {
    this.workspace.log.push('detach');
    this.parent.children = this.parent.children.filter((leaf) => leaf !== this);
    this.workspace.leaves = this.workspace.leaves.filter((leaf) => leaf !== this);
    this.workspace.fire('layout-change');
  };
}

export class FakeWorkspace {
  readonly log: string[] = [];
  readonly rootSplit = { name: 'root' };
  readonly popout = { name: 'popout' };
  readonly mainGroup = new FakeGroup(this.rootSplit);
  readonly popoutGroup = new FakeGroup(this.popout);
  leaves: FakeLeaf[] = [];
  activeLeaf: FakeLeaf | null = null;
  private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  private created = new Map<FakeLeaf, boolean>();

  /** A leaf of the test's own (a board, a note). */
  add(group: FakeGroup = this.mainGroup, type = 'tabletop-board'): FakeLeaf {
    const leaf = new FakeLeaf(this, group);
    leaf.type = type;
    group.children.push(leaf);
    this.leaves.push(leaf);
    return leaf;
  }
  /** A loaded Atlas leaf with a view, as the user opened it. */
  addAtlas(): { leaf: FakeLeaf; view: FakeAtlasView } {
    const leaf = this.add(this.mainGroup, 'atlas-vtt');
    const view = new FakeAtlasView(this.log);
    leaf.view = view;
    return { leaf, view };
  }
  /** An Atlas leaf Obsidian restored without loading it. */
  addDeferredAtlas(file: string): FakeLeaf {
    const leaf = this.add(this.mainGroup, 'atlas-vtt');
    leaf.isDeferred = true;
    leaf.deferredFile = file;
    return leaf;
  }
  atlasView(): FakeAtlasView | null {
    const leaf = this.leaves.find((each) => each.view instanceof FakeAtlasView);
    return leaf ? (leaf.view as FakeAtlasView) : null;
  }
  activatedSince(leaf: FakeLeaf): boolean {
    return this.created.get(leaf) === true;
  }

  getLeavesOfType = (type: string): FakeLeaf[] => this.leaves.filter((leaf) => leaf.type === type);
  getMostRecentLeaf = (root?: object): FakeLeaf | null => this.leaves.find((leaf) => !root || leaf.getRoot() === root) ?? null;
  getLeaf = (): FakeLeaf => {
    this.log.push('getLeaf');
    const leaf = this.add(this.activeLeaf?.parent ?? this.mainGroup, 'empty');
    this.created.set(leaf, false);
    return leaf;
  };
  createLeafInParent = (group: FakeGroup): FakeLeaf => {
    this.log.push('createLeafInParent');
    const leaf = this.add(group, 'empty');
    this.created.set(leaf, false);
    return leaf;
  };
  setActiveLeaf = (leaf: FakeLeaf): void => {
    this.log.push('setActiveLeaf');
    this.activeLeaf = leaf;
    for (const key of this.created.keys()) this.created.set(key, true);
    this.fire('active-leaf-change');
  };
  on = (name: string, handler: (...args: unknown[]) => void): object => {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler);
    this.handlers.set(name, set);
    return { name, handler };
  };
  offref = (ref: object): void => {
    const { name, handler } = ref as { name: string; handler: (...args: unknown[]) => void };
    this.handlers.get(name)?.delete(handler);
  };
  fire(name: string): void {
    // `active-leaf-change` hands over the leaf made active, as Obsidian does.
    for (const handler of [...(this.handlers.get(name) ?? [])]) handler(...(name === 'active-leaf-change' ? [this.activeLeaf] : []));
  }
}

export interface FakeHostApp {
  app: App;
  workspace: FakeWorkspace;
  plugins: { plugins: Record<string, unknown>; manifests: Record<string, { version?: unknown }> };
}

/** An app with Atlas enabled at `version` (null: Atlas not enabled) and the given map files in the vault. */
export function fakeHostApp(files: string[] = [], version: string | null = '0.15.0'): FakeHostApp {
  const workspace = new FakeWorkspace();
  const plugins = { plugins: version === null ? {} : { 'atlas-vtt': { manifest: { version } } }, manifests: version === null ? {} : { 'atlas-vtt': { version } } } as FakeHostApp['plugins'];
  const vault = { getAbstractFileByPath: (path: string) => (files.includes(path) ? { path, extension: 'atlasmap', basename: path } : null) };
  return { app: { workspace, plugins, vault } as unknown as App, workspace, plugins };
}

export const asLeaf = (leaf: FakeLeaf): WorkspaceLeaf => leaf as unknown as WorkspaceLeaf;
