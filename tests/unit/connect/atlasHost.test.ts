import { describe, expect, it } from 'vitest';
import { AtlasHost, HOST_LOAD_MS, HOST_MARK, type FollowResult, type HostMark, type HostStore } from '../../../packages/atlas-host/src/index';
import { asLeaf, fakeHostApp, type FakeAtlasView, type FakeLeaf } from '../../fake/fakeHostWorkspace';

const A = 'maps/a.atlasmap';
const B = 'maps/b.atlasmap';
const tick = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** A host over a fake workspace, with a clock the test runs out by hand (`timeout()`). */
function setup(pluginId = 'tabletop-for-atlas', files = [A, B], version: string | null = '0.15.0') {
  const fake = fakeHostApp(files, version);
  const timers: Array<() => void> = [];
  const waits: number[] = [];
  const host = new AtlasHost(fake.app, { pluginId, wait: (ms) => new Promise((resolve) => { waits.push(ms); timers.push(resolve); }) });
  const board = fake.workspace.add();
  fake.workspace.activeLeaf = board;
  return { ...fake, host, board, waits, timeout: async () => { for (const timer of timers.splice(0)) timer(); await tick(); } };
}
/** The fake Atlas view on map `path`, loaded. */
function loadedOn(view: FakeAtlasView, path: string): void {
  view.tabs.push({ id: `t-${path}`, filePath: path });
  view.file = { path };
  view.loaded();
}

describe('the Atlas host', () => {
  it('holds is false while loading and true once loaded', async () => {
    const s = setup();
    const { view } = s.workspace.addAtlas();
    s.workspace.fire('layout-change');
    expect(s.host.status()).toEqual({ kind: 'loading', mapPath: null });
    await view.onLoadFile({ path: A });
    expect(s.host.holds(A)).toBe(false);
    expect(s.host.store(A)).toBeNull();
    expect(s.host.status()).toEqual({ kind: 'loading', mapPath: A });
    view.loaded();
    expect(s.host.holds(A)).toBe(true);
    expect(s.host.store(A)).toBe(view.atlasStore);
    expect(s.host.holds(B)).toBe(false);
    expect(s.host.status()).toEqual({ kind: 'held', mapPath: A });
  });

  it('follow switches to an existing internal tab and never opens a leaf', async () => {
    const s = setup();
    const { view } = s.workspace.addAtlas();
    loadedOn(view, A);
    view.tabs.push({ id: 't-b', filePath: B });
    s.workspace.fire('layout-change');
    const following = s.host.follow(B, asLeaf(s.board));
    await tick();
    view.loaded();
    await expect(following).resolves.toBe('held');
    expect(s.workspace.log).toContain(`switchToTab(${B})`);
    expect(s.workspace.log).not.toContain('createLeafInParent');
    expect(s.workspace.log).not.toContain('getLeaf');
    expect(s.workspace.getLeavesOfType('atlas-vtt')).toHaveLength(1);
    expect(s.workspace.activeLeaf).toBe(s.board);
    await expect(s.host.follow(B, asLeaf(s.board))).resolves.toBe('held');
  });

  it('follow loads a deferred leaf', async () => {
    const s = setup();
    s.workspace.addDeferredAtlas(A);
    s.workspace.fire('layout-change');
    expect(s.host.status()).toEqual({ kind: 'none' });
    const following = s.host.follow(A, asLeaf(s.board));
    await tick();
    expect(s.workspace.log).toContain('loadIfDeferred');
    expect(s.workspace.log.filter((entry) => entry.startsWith('onLoadFile'))).toEqual([`onLoadFile(${A})`]);
    s.workspace.atlasView()?.loaded();
    await expect(following).resolves.toBe('held');
    expect(s.workspace.getLeavesOfType('atlas-vtt')).toHaveLength(1);
  });

  it('follow opens a background leaf and keeps the front active', async () => {
    const s = setup();
    const following = s.host.follow(A, asLeaf(s.board));
    await tick();
    expect(s.workspace.activeLeaf).toBe(s.board);
    expect(s.workspace.log.slice(0, 3)).toEqual(['createLeafInParent', 'setActiveLeaf', 'setViewState(atlas-vtt)']);
    const leaf = s.workspace.getLeavesOfType('atlas-vtt')[0] as FakeLeaf;
    expect(leaf.parent).toBe(s.board.parent);
    expect((leaf as unknown as Record<string, HostMark>)[HOST_MARK]?.openedBy).toBe('tabletop-for-atlas');
    s.workspace.atlasView()?.loaded();
    await expect(following).resolves.toBe('held');
    expect(s.host.holds(A)).toBe(true);
  });

  it('follow into an existing host without the map loads it there, opens no leaf and keeps the front', async () => {
    const s = setup();
    const { leaf, view } = s.workspace.addAtlas();
    loadedOn(view, A);
    s.workspace.fire('layout-change');
    const following = s.host.follow(B, asLeaf(s.board));
    await tick();
    expect(s.workspace.log).toContain(`onLoadFile(${B})`);
    expect(s.workspace.getLeavesOfType('atlas-vtt')).toEqual([leaf]);
    expect(s.workspace.activeLeaf).toBe(s.board);
    expect((leaf as unknown as Record<string, HostMark>)[HOST_MARK]?.openedBy ?? null).toBeNull();
    view.loaded();
    await expect(following).resolves.toBe('held');
  });

  it('a board in a popout opens the host in the main window', async () => {
    const s = setup();
    const note = s.workspace.add(s.workspace.mainGroup, 'markdown');
    const popped = s.workspace.add(s.workspace.popoutGroup);
    s.workspace.activeLeaf = popped;
    void s.host.follow(A, asLeaf(popped));
    await tick();
    const leaf = s.workspace.getLeavesOfType('atlas-vtt')[0] as FakeLeaf;
    expect(leaf.parent).toBe(note.parent);
    expect(leaf.getRoot()).toBe(s.workspace.rootSplit);
    expect(s.workspace.activeLeaf).toBe(popped);
  });

  it('follow times out after HOST_LOAD_MS', async () => {
    const s = setup();
    const following = s.host.follow(A, asLeaf(s.board));
    await tick();
    expect(s.waits).toContain(HOST_LOAD_MS);
    await s.timeout();
    await expect(following).resolves.toBe('timeout');
    expect(s.host.holds(A)).toBe(false);
  });

  it('answers no-file and no-atlas without opening anything', async () => {
    const s = setup();
    await expect(s.host.follow('maps/none.atlasmap', asLeaf(s.board))).resolves.toBe('no-file');
    const none = setup('tabletop-for-atlas', [A], null);
    await expect(none.host.follow(A, asLeaf(none.board))).resolves.toBe('no-atlas');
    expect(none.workspace.getLeavesOfType('atlas-vtt')).toHaveLength(0);
  });

  it('a second follow supersedes the first', async () => {
    const s = setup();
    const { view } = s.workspace.addAtlas();
    s.workspace.fire('layout-change');
    const first = s.host.follow(A, asLeaf(s.board));
    await tick();
    const second = s.host.follow(B, asLeaf(s.board));
    await tick();
    view.loaded();
    await expect(first).resolves.toBe('superseded');
    await expect(second).resolves.toBe('held');
    expect(s.host.holds(B)).toBe(true);
  });

  it('a follow of the same map in flight joins it', async () => {
    const s = setup();
    const results: Array<Promise<FollowResult>> = [];
    // The recipe's own setActiveLeaf(front) fires active-leaf-change, which a board answers with follow.
    s.workspace.on('active-leaf-change', () => { results.push(s.host.follow(A, asLeaf(s.board))); });
    results.push(s.host.follow(A, asLeaf(s.board)));
    await tick();
    expect(results.length).toBeGreaterThan(1);
    s.workspace.atlasView()?.loaded();
    await expect(Promise.all(results)).resolves.toEqual(results.map(() => 'held'));
    expect(s.workspace.getLeavesOfType('atlas-vtt')).toHaveLength(1);
    expect(s.workspace.log.filter((entry) => entry === 'createLeafInParent')).toHaveLength(1);
  });

  it('whenHeld resolves in call order once the map loads', async () => {
    const s = setup();
    const { view } = s.workspace.addAtlas();
    s.workspace.fire('layout-change');
    void s.host.follow(A, asLeaf(s.board));
    await tick();
    const order: number[] = [];
    const waits = [1, 2, 3].map((n) => s.host.whenHeld(A).then((store) => { order.push(n); return store; }));
    view.loaded();
    const stores: Array<HostStore | null> = await Promise.all(waits);
    expect(stores).toEqual([view.atlasStore, view.atlasStore, view.atlasStore]);
    expect(order).toEqual([1, 2, 3]);
    await expect(s.host.whenHeld(A)).resolves.toBe(view.atlasStore);
    await expect(s.host.whenHeld(B)).resolves.toBeNull();
  });

  it('whenHeld resolves null when the host lands on another map', async () => {
    const s = setup();
    const { view } = s.workspace.addAtlas();
    s.workspace.fire('layout-change');
    void s.host.follow(A, asLeaf(s.board));
    await tick();
    const waits = [s.host.whenHeld(A), s.host.whenHeld(A), s.host.whenHeld(A)];
    void s.host.follow(B, asLeaf(s.board));
    await tick();
    view.loaded();
    await expect(Promise.all(waits)).resolves.toEqual([null, null, null]);
    expect(s.host.holds(B)).toBe(true);
  });

  it('whenHeld gives up after HOST_LOAD_MS', async () => {
    const s = setup();
    s.workspace.addAtlas();
    s.workspace.fire('layout-change');
    void s.host.follow(A, asLeaf(s.board));
    await tick();
    const waiting = s.host.whenHeld(A);
    await s.timeout();
    await expect(waiting).resolves.toBeNull();
  });

  it('release detaches only a leaf a plugin opened, once no plugin claims it', async () => {
    const s = setup('tabletop-for-atlas');
    const connect = new AtlasHost(s.app, { pluginId: 'atlas-vtt-connect', wait: () => new Promise(() => undefined) });
    const releaseBoard = s.host.claim();
    const following = s.host.follow(A, asLeaf(s.board));
    await tick();
    s.workspace.atlasView()?.loaded();
    await following;
    const leaf = s.workspace.getLeavesOfType('atlas-vtt')[0] as FakeLeaf;
    const releaseConnect = connect.claim();
    const mark = (leaf as unknown as Record<string, HostMark>)[HOST_MARK];
    expect(mark?.claims.get('tabletop-for-atlas')).toBe(1);
    expect(mark?.claims.get('atlas-vtt-connect')).toBe(1);
    releaseBoard();
    expect(s.workspace.getLeavesOfType('atlas-vtt')).toHaveLength(1);
    releaseConnect();
    releaseConnect();
    expect(s.workspace.getLeavesOfType('atlas-vtt')).toHaveLength(0);
    expect(s.host.closedByUser()).toBe(false);
    expect(connect.closedByUser()).toBe(false);

    const user = setup();
    const opened = user.workspace.addAtlas();
    loadedOn(opened.view, A);
    user.workspace.fire('layout-change');
    const release = user.host.claim();
    await user.host.follow(A, asLeaf(user.board));
    release();
    expect(user.workspace.getLeavesOfType('atlas-vtt')).toEqual([opened.leaf]);
  });

  it('a tab the user has brought to the front is theirs: the last release leaves it open', async () => {
    const s = setup();
    const release = s.host.claim();
    const following = s.host.follow(A, asLeaf(s.board));
    await tick();
    s.workspace.atlasView()?.loaded();
    await following;
    const leaf = s.workspace.getLeavesOfType('atlas-vtt')[0] as FakeLeaf;
    const mark = (leaf as unknown as Record<string, HostMark>)[HOST_MARK];
    expect(mark?.openedBy).toBe('tabletop-for-atlas');
    // Atlas sends every scene the user opens to its one tab and brings it forward: the user works there now.
    s.workspace.setActiveLeaf(leaf);
    expect(mark?.openedBy).toBeNull();
    s.workspace.setActiveLeaf(s.board);
    release();
    expect(s.workspace.getLeavesOfType('atlas-vtt')).toEqual([leaf]);
    expect(s.host.closedByUser()).toBe(false);
  });

  it('the front made active again by the recipe does not hand the tab to the user', async () => {
    const s = setup();
    const release = s.host.claim();
    const following = s.host.follow(A, asLeaf(s.board));
    await tick();
    s.workspace.atlasView()?.loaded();
    await following;
    // The board is active again and again (each press on it): the tab stays the plugin's.
    s.workspace.setActiveLeaf(s.board);
    release();
    expect(s.workspace.getLeavesOfType('atlas-vtt')).toHaveLength(0);
  });

  it('closedByUser after the leaf is detached while claimed, cleared by the next follow', async () => {
    const s = setup();
    const heard: string[] = [];
    s.host.onChange(() => heard.push(s.host.status().kind));
    s.host.claim();
    const following = s.host.follow(A, asLeaf(s.board));
    await tick();
    s.workspace.atlasView()?.loaded();
    await following;
    expect(s.host.closedByUser()).toBe(false);
    (s.workspace.getLeavesOfType('atlas-vtt')[0] as FakeLeaf).detach();
    expect(s.host.closedByUser()).toBe(true);
    expect(s.host.status()).toEqual({ kind: 'none' });
    expect(heard.at(-1)).toBe('none');
    void s.host.follow(A, asLeaf(s.board));
    await tick();
    expect(s.host.closedByUser()).toBe(false);
  });

  it('dispose stops hearing the workspace and answers its waiters', async () => {
    const s = setup();
    s.workspace.addAtlas();
    s.workspace.fire('layout-change');
    void s.host.follow(A, asLeaf(s.board));
    await tick();
    const waiting = s.host.whenHeld(A);
    s.host.dispose();
    await expect(waiting).resolves.toBeNull();
  });
});
