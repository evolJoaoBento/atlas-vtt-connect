import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import type { TabInfo, TabScenes } from '../../../src/app/online/atlas/tabScenes';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { CutsceneSender } from '../../../src/app/online/scene/CutsceneSender';
import type { BoardCutscene } from '../../../src/app/online/scene/boardTypes';
import type { GmCutscene } from '../../../src/app/online/scene/sceneContracts';
import type { BoardPose, BoardSource } from '../../../src/app/online/scene/sceneSources';
import { fakeAssetIds, snapshotOf } from './sceneFixtures';

const PATHS = { k1: 'maps/crypt.atlasmap', k2: 'maps/tavern.atlasmap' };
const pose = { x: 1, y: 2, z: 3 };

function run(runId: string, key: string, mode: 'prepared' | 'live' = 'prepared', seq = 1): GmCutscene {
  const shots = mode === 'live' ? [] : [
    { key: 'k1', eye: pose, target: pose, at: 0, keyframe: false, transition: 'fade' as const },
    { key: 'k2', eye: pose, target: pose, at: 1000, keyframe: false, transition: 'fade' as const },
  ];
  const cutscene: BoardCutscene = { runId, mode, look: { bars: 2.39, fadeMs: 600 }, shots, step: { shot: key === 'k2' && mode === 'prepared' ? 1 : 0, seq }, key };
  return { cutscene, maps: PATHS };
}

function world() {
  let current: GmCutscene | null = null;
  let camera: BoardPose | null = { eye: pose, target: pose };
  const changes = new Set<() => void>();
  const cameras = new Set<() => void>();
  const board = {
    available: () => true, lookFor: () => null, camera: () => null, subscribe: () => () => undefined, subscribeCamera: () => () => undefined,
    cutscene: () => current,
    subscribeCutscene: (listener: () => void) => { changes.add(listener); return () => { changes.delete(listener); }; },
    cutsceneCamera: () => camera,
    subscribeCutsceneCamera: (listener: () => void) => { cameras.add(listener); return () => { cameras.delete(listener); }; },
  } as BoardSource;

  const live = new Set<string>();
  const watchers = new Set<() => void>();
  const liveListeners = new Set<() => void>();
  const infos: TabInfo[] = [
    { viewId: 'v1', tabId: 'a', mapPath: PATHS.k1, name: 'Crypt' },
    { viewId: 'v1', tabId: 'b', mapPath: PATHS.k2, name: 'Tavern' },
  ];
  const tabs = {
    tabs: () => infos,
    liveSnapshot: (key: { tabId: string }): SceneSnapshot | null => (live.has(key.tabId)
      ? snapshotOf({ mapPath: infos.find((info) => info.tabId === key.tabId)!.mapPath, objects: { tokens: {}, texts: {}, drawings: {}, fog: {} } })
      : null),
    watch: (_view: string, listener: () => void) => { watchers.add(listener); return () => { watchers.delete(listener); }; },
    subscribeLive: (listener: () => void) => { liveListeners.add(listener); return () => { liveListeners.delete(listener); }; },
    subscribeTabs: () => () => undefined,
  } as unknown as TabScenes;

  const sent: Array<{ to: string; message: ControlMessage }> = [];
  const handlers: SessionHandler[] = [];
  const players: SessionPlayer[] = [];
  const session = {
    use: (handler: SessionHandler) => { handlers.push(handler); return () => undefined; },
    send: (to: string, message: ControlMessage) => { sent.push({ to, message }); },
    getPlayers: () => players,
  };
  const addPlayer = (id: string): SessionPlayer => {
    const player = { playerId: id, name: id, status: 'admitted' } as SessionPlayer;
    players.push(player);
    return player;
  };
  const sender = new CutsceneSender({
    session, tabs, board,
    sceneOptions: { settings: { getLocalPlayerViewSettings: () => ({ showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true }), onChange: () => () => undefined } },
    assets: { ...fakeAssetIds(), onChange: () => () => undefined },
  });
  sender.start();
  const handler = handlers[0]!;
  return {
    sender, addPlayer, sent, watchers,
    publish: (next: GmCutscene | null) => { current = next; for (const listener of [...changes]) listener(); },
    moveCamera: (z: number) => { camera = { eye: pose, target: { x: 1, y: 2, z } }; for (const listener of [...cameras]) listener(); },
    goLive: (...tabIds: string[]) => { tabIds.forEach((id) => live.add(id)); for (const listener of [...liveListeners]) listener(); },
    ready: (player: SessionPlayer, on = true) => handler.onMessage?.(player, { v: 1, type: 'cutscene-ready', on }),
    resync: (player: SessionPlayer) => handler.onMessage?.(player, { v: 1, type: 'scene-resync', seq: 0 }),
    admit: (player: SessionPlayer) => handler.onAdmitted?.(player),
    of: (to: string, type: ControlMessage['type']) => sent.filter((entry) => entry.to === to && entry.message.type === type).map((entry) => entry.message),
  };
}

describe('CutsceneSender', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends the cutscene to every admitted player when the source changes', () => {
    const w = world();
    w.addPlayer('anna');
    w.addPlayer('ben');
    w.publish(run('r1', 'k1'));
    expect(w.of('anna', 'cutscene')).toHaveLength(1);
    expect(w.of('ben', 'cutscene')).toHaveLength(1);
    expect(w.sender.running()).toBe(true);
    // The same publication twice tells once.
    w.publish(run('r1', 'k1'));
    expect(w.of('anna', 'cutscene')).toHaveLength(1);
  });

  it('sends scene and extras only to the player who is ready', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.addPlayer('ben');
    w.goLive('a');
    w.publish(run('r1', 'k1'));
    w.ready(anna);
    expect(w.of('anna', 'cutscene-scene')).toHaveLength(1);
    expect(w.of('anna', 'cutscene-extras')).toHaveLength(1);
    expect(w.of('ben', 'cutscene-scene')).toHaveLength(0);
    expect(w.of('ben', 'cutscene-extras')).toHaveLength(0);
  });

  it('admitted mid-run gets the cutscene, scene and extras', () => {
    const w = world();
    w.addPlayer('anna');
    w.goLive('a');
    w.publish(run('r1', 'k1'));
    const late = w.addPlayer('late');
    w.admit(late);
    expect(w.of('late', 'cutscene')).toHaveLength(1);
    expect(w.of('late', 'cutscene-scene')).toHaveLength(0);
    w.ready(late);
    expect(w.of('late', 'cutscene-scene')).toHaveLength(1);
    expect(w.of('late', 'cutscene-extras')).toHaveLength(1);
    expect(w.of('late', 'cutscene-scene')[0]).toMatchObject({ runId: 'r1', key: 'k1' });
  });

  it('waits for a map whose tab is not live yet, then sends it at once', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.publish(run('r1', 'k1'));
    w.ready(anna);
    expect(w.of('anna', 'cutscene-scene')).toHaveLength(0);
    w.goLive('b');
    expect(w.of('anna', 'cutscene-scene')).toMatchObject([{ key: 'k2' }]);
  });

  it('sends a new map of the run right away, and a ready player gets the other maps on resync', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.goLive('a', 'b');
    w.publish(run('r1', 'k1'));
    w.ready(anna);
    expect(w.of('anna', 'cutscene-scene').map((m) => (m as { key: string }).key)).toEqual(['k1', 'k2']);
    w.resync(anna);
    expect(w.of('anna', 'cutscene-scene')).toHaveLength(4);
  });

  it('sends the live camera at most every 100 ms, the last move included', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.goLive('a');
    w.publish(run('r1', 'k1', 'live'));
    w.ready(anna);
    const before = w.of('anna', 'cutscene-camera').length;
    for (let z = 10; z < 20; z += 1) w.moveCamera(z);
    expect(w.of('anna', 'cutscene-camera').length - before).toBe(1);
    vi.advanceTimersByTime(100);
    const cameras = w.of('anna', 'cutscene-camera');
    expect(cameras.length - before).toBe(2);
    expect(cameras.at(-1)).toMatchObject({ runId: 'r1', target: { z: 19 } });
  });

  it('ends: cutscene null to everyone, the tab no longer watched, the files no longer served', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.addPlayer('ben');
    w.goLive('a');
    w.publish(run('r1', 'k1'));
    w.ready(anna);
    expect(w.watchers.size).toBeGreaterThan(0);
    w.publish(null);
    expect(w.of('anna', 'cutscene').at(-1)).toEqual({ v: 1, type: 'cutscene', cutscene: null });
    expect(w.of('ben', 'cutscene').at(-1)).toEqual({ v: 1, type: 'cutscene', cutscene: null });
    expect(w.watchers.size).toBe(0);
    expect(w.sender.running()).toBe(false);
    expect(w.sender.assetsFor('anna').size).toBe(0);
    const count = w.sent.length;
    vi.advanceTimersByTime(1000);
    expect(w.sent.length).toBe(count);
  });

  it('never puts a vault path on the wire', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.addPlayer('ben');
    w.goLive('a', 'b');
    w.publish(run('r1', 'k1'));
    w.ready(anna);
    w.publish(run('r1', 'k2', 'prepared', 2));
    w.publish(null);
    expect(w.sent.length).toBeGreaterThan(5);
    for (const { message } of w.sent) expect(encodeControl(message)).not.toContain('.atlasmap');
  });
});
