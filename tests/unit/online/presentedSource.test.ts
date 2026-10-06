import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character } from '@atlas-vtt/api-types';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { SCENE_TICK_MS, SceneHub } from '../../../src/app/online/scene/SceneHub';
import { SceneAssignments } from '../../../src/app/online/split/SceneAssignments';
import { LIT_SCENE_NEEDS_UPDATE_NOTICE } from '../../../src/app/online/scene/sceneLighting';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import type { LiveScene } from '../../../src/app/online/atlas/presentedSource';
import { memoryImageFiles, nodeHash } from './assetFixtures';
import { emptySceneState, presenter, sceneView, type ViewState } from './presentedFixtures';
import { HUB_PATHS, onHubPath, pathPresenter, pathTabs } from './hubPath';

function character(id: string, x: number): Character {
  return { id, kind: 'character', x, y: 140, imagePath: `art/${id}.png`, name: id };
}

function withHero(state: ViewState = emptySceneState()): ViewState {
  return {
    ...state,
    objects: {
      ...state.objects,
      tokens: { hero: character('hero', 140) },
      texts: { tx: { id: 'tx', kind: 'text', x: 100, y: 100, text: 'Beware', fontSize: 16, fontFamily: 'serif', color: '#000000' } as never },
      drawings: { d1: { id: 'd1', kind: 'drawing', timestamp: 2, type: 'pen', points: [{ x: 100, y: 100 }, { x: 110, y: 110 }], color: '#ff0000', width: 2, opacity: 1 } },
    },
  };
}

function world() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), { title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {} });
  gm.start();
  const presented = pathPresenter();
  const notices: string[] = [];
  const settings = { getLocalPlayerViewSettings: () => ({ showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true }), onChange: () => () => {} };
  const assets = new AssetRegistry({ files: memoryImageFiles().source, notify: () => {}, hash: nodeHash });
  const broadcaster = new SceneHub({ tabs: pathTabs(presented), assignments: new SceneAssignments(), session: gm, presented, settings, assets, notify: (message) => notices.push(message) });
  broadcaster.start();
  const raw = async (): Promise<ControlMessage[]> => {
    const link = await network.client().connect('gm');
    const received: ControlMessage[] = [];
    link.onMessage((channel, data) => {
      const decoded = channel === 'control' && typeof data === 'string' ? decodeControl(data) : null;
      if (decoded?.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Raw', playerKey: `k${requests.length}`, client: { kind: 'web', version: '1' } }));
    gm.allow(requests.at(-1)!.playerId);
    return received;
  };
  return { presented, broadcaster, notices, raw };
}

/** The scene messages a player got, without the parts that follow a snapshot. */
const sceneTypes = (messages: ControlMessage[]): string[] => messages.map((message) => message.type)
  .filter((type) => type.startsWith('scene-') && type !== 'scene-fog' && type !== 'scene-drawings');

describe.each(HUB_PATHS)('presentedSource, $atlas', ({ tabs }) => {
  onHubPath(tabs);
  it('gives one object per presentation: the same through a hold and its resume, a new one after clear', async () => {
    const presented = presenter();
    const view = sceneView(presented, emptySceneState());
    const seen: Array<[string, LiveScene]> = [];
    presented.subscribe({
      presented: (scene) => seen.push(['presented', scene]),
      held: (scene) => seen.push(['held', scene]),
      cleared: (scene) => seen.push(['cleared', scene]),
    });
    presented.present(view.view, view.tavern);
    const first = presented.current();
    view.tabs.getState().setActiveTab(view.dungeon);
    expect(presented.isHeld()).toBe(true);
    expect(presented.current()?.info.held).toBe(true);
    view.tabs.getState().setActiveTab(view.tavern);
    await Promise.resolve();
    expect(seen.map(([event]) => event)).toEqual(['presented', 'held', 'presented']);
    expect(seen.every(([, scene]) => scene === first)).toBe(true);
    expect(first?.info.held).toBe(false);
    presented.clear();
    presented.present(view.view, view.tavern);
    expect(presented.current()).not.toBe(first);
  });

  it('counts a hold while the view shows the presented tab as a new presentation (its map not loaded)', () => {
    const presented = presenter();
    const view = sceneView(presented, emptySceneState());
    presented.subscribe({});
    presented.present(view.view, view.tavern);
    const first = presented.current();
    view.store.setState({ isMapLoading: true });
    presented.present(view.view, view.tavern);
    expect(presented.isHeld()).toBe(true);
    expect(presented.current()).not.toBe(first);
  });

  it('reads the scene, the camera and their changes of the presented view through the API', () => {
    const presented = presenter();
    const view = sceneView(presented, withHero(), { mapSize: { width: 700, height: 500 }, camera: () => ({ centerX: 1, centerY: 2, width: 3, height: 4 }) });
    presented.present(view.view, view.tavern);
    const scene = presented.current()!;
    expect(scene.info).toMatchObject({ viewId: view.view, tabId: 'tavern', mapPath: 'maps/tavern.atlasmap' });
    expect(Object.keys(scene.snapshot()!.objects.tokens)).toEqual(['hero']);
    expect(scene.snapshot()!.mapSize).toEqual({ width: 700, height: 500 });
    expect(scene.camera()).toEqual({ centerX: 1, centerY: 2, width: 3, height: 4 });
    const changes = vi.fn();
    const frames = vi.fn();
    const stop = scene.subscribe(changes);
    scene.watchCamera(frames);
    view.store.setState({ background: 'maps/other.png' });
    presented.atlas.views.frame(view.view);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(frames).toHaveBeenCalledTimes(1);
    stop();
    view.store.setState({ background: 'maps/third.png' });
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('keeps one subscription to Atlas for all its listeners, and none once they all left', () => {
    const presented = presenter();
    const before = presented.atlas.listenerCount();
    const stops = [presented.subscribe({}), presented.subscribe({})];
    expect(presented.atlas.listenerCount()).toBe(before + 1);
    stops.forEach((stop) => stop());
    expect(presented.atlas.listenerCount()).toBe(before);
  });
});

describe.each(HUB_PATHS)('the broadcaster across presentations, $atlas', ({ tabs }) => {
  onHubPath(tabs);
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends no clear when the GM browses another tab, and the same scene id when the tab comes back', async () => {
    const w = world();
    const view = sceneView(w.presented, withHero());
    w.presented.present(view.view, view.tavern);
    const received = await w.raw();
    const sceneId = w.broadcaster.currentProjection()?.sceneId;
    view.tabs.getState().setActiveTab(view.dungeon);
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    // Split party (spec Goal 2): the held scene is paused, and its resume patches what changed (nothing here).
    expect(sceneTypes(received)).toEqual(['scene-snapshot', 'scene-state']);
    view.tabs.getState().setActiveTab(view.tavern);
    await vi.advanceTimersByTimeAsync(0);
    expect(sceneTypes(received)).toEqual(['scene-snapshot', 'scene-state', 'scene-state']);
    expect(w.broadcaster.currentProjection()?.sceneId).toBe(sceneId);
  });

  it('clears players when another tab is presented while the scene is held, and a new presentation after clear gets a new scene id', async () => {
    const w = world();
    const view = sceneView(w.presented, withHero());
    w.presented.present(view.view, view.tavern);
    const received = await w.raw();
    const first = w.broadcaster.currentProjection()?.sceneId;
    view.tabs.getState().setActiveTab(view.dungeon);
    // Split party (spec Goal 2): the held scene is paused.
    expect(sceneTypes(received)).toEqual(['scene-snapshot', 'scene-state']);
    w.presented.present(view.view, view.dungeon);
    expect(sceneTypes(received)).toEqual(['scene-snapshot', 'scene-state', 'scene-clear']);
    w.presented.clear();
    w.presented.present(view.view, view.tavern);
    view.tabs.getState().setActiveTab(view.tavern);
    await vi.advanceTimersByTimeAsync(0);
    expect(sceneTypes(received).at(-1)).toBe('scene-snapshot');
    expect(w.broadcaster.currentProjection()?.sceneId).not.toBe(first);
  });

  it('clears players when the presented tab is presented again before its map loaded', async () => {
    const w = world();
    const view = sceneView(w.presented, withHero());
    w.presented.present(view.view, view.tavern);
    const received = await w.raw();
    const first = w.broadcaster.currentProjection()?.sceneId;
    view.store.setState({ isMapLoading: true });
    w.presented.present(view.view, view.tavern);
    expect(sceneTypes(received)).toEqual(['scene-snapshot', 'scene-clear']);
    view.store.setState({ isMapLoading: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(sceneTypes(received)).toEqual(['scene-snapshot', 'scene-clear', 'scene-snapshot']);
    expect(w.broadcaster.currentProjection()?.sceneId).not.toBe(first);
  });

  it('without the lighting capability a lit scene reaches players with no tokens, texts or drawings, and the GM is told once', async () => {
    const w = world();
    const view = sceneView(w.presented, { ...withHero(), lighting: { enabled: true, ambient: 0.2 } }, { mapSize: { width: 1000, height: 800 } });
    w.presented.present(view.view, view.tavern);
    const received = await w.raw();
    const scene = w.broadcaster.currentProjection()!;
    expect(scene.tokens).toEqual({});
    expect(scene.texts).toEqual({});
    expect(scene.drawings).toEqual({});
    expect(JSON.stringify(received)).not.toContain('Beware');
    view.store.setState((state) => ({ objects: { ...state.objects, tokens: { hero: character('hero', 300) } } }));
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    expect(w.broadcaster.currentProjection()?.tokens).toEqual({});
    expect(w.notices).toEqual([LIT_SCENE_NEEDS_UPDATE_NOTICE]);
  });
});
