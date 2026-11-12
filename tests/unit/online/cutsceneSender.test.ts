import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import type { TabInfo, TabScenes } from '../../../src/app/online/atlas/tabScenes';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { CutsceneSender, STEP_WAIT_MS, type CutsceneSenderOptions } from '../../../src/app/online/scene/CutsceneSender';
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

function world(initial: GmCutscene | null = null, extra: Partial<CutsceneSenderOptions> = {}) {
  let current: GmCutscene | null = initial;
  const notices: string[] = [];
  let handlerOn = false;
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
  /** The tabs the GM is on (their view's active tab); a live tab is active too. */
  const active = new Set<string>();
  const watchers = new Set<() => void>();
  const liveListeners = new Set<() => void>();
  const tabsListeners = new Set<() => void>();
  const infos: TabInfo[] = [
    { viewId: 'v1', tabId: 'a', mapPath: PATHS.k1, name: 'Crypt' },
    { viewId: 'v1', tabId: 'b', mapPath: PATHS.k2, name: 'Tavern' },
  ];
  /** The tokens each tab's map holds now. */
  const tokensOf = new Map<string, Record<string, unknown>>();
  const tabs = {
    tabs: () => infos,
    liveSnapshot: (key: { tabId: string }): SceneSnapshot | null => (live.has(key.tabId)
      ? snapshotOf({ mapPath: infos.find((info) => info.tabId === key.tabId)!.mapPath, objects: { tokens: tokensOf.get(key.tabId) ?? {}, texts: {}, drawings: {}, fog: {} } as SceneSnapshot['objects'] })
      : null),
    isActive: (key: { tabId: string }) => active.has(key.tabId),
    watch: (_view: string, listener: () => void) => { watchers.add(listener); return () => { watchers.delete(listener); }; },
    subscribeLive: (listener: () => void) => { liveListeners.add(listener); return () => { liveListeners.delete(listener); }; },
    subscribeTabs: (listener: () => void) => { tabsListeners.add(listener); return () => { tabsListeners.delete(listener); }; },
  } as unknown as TabScenes;
  const tellLive = (): void => { for (const listener of [...liveListeners]) listener(); };

  const sent: Array<{ to: string; message: ControlMessage }> = [];
  const handlers: SessionHandler[] = [];
  const players: SessionPlayer[] = [];
  const session = {
    use: (handler: SessionHandler) => { handlers.push(handler); handlerOn = true; return () => { handlerOn = false; }; },
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
    notify: (message) => { notices.push(message); },
    ...extra,
  });
  sender.start();
  const handler = handlers[0]!;
  return {
    sender, addPlayer, sent, watchers, notices, players, changes, cameras, liveListeners, handlerOn: () => handlerOn,
    gone: (player: SessionPlayer) => handler.onGone?.(player),
    kick: (player: SessionPlayer) => { player.status = 'removed' as never; sender.playersChanged(players); },
    publish: (next: GmCutscene | null) => { current = next; for (const listener of [...changes]) listener(); },
    moveCamera: (z: number) => { camera = { eye: pose, target: { x: 1, y: 2, z } }; for (const listener of [...cameras]) listener(); },
    goLive: (...tabIds: string[]) => { tabIds.forEach((id) => { live.add(id); active.add(id); }); tellLive(); },
    /** The GM's board went to a tab: active, its map still loading (not live). */
    activate: (tabId: string) => { active.add(tabId); tellLive(); },
    /** The GM's board left a tab: neither active nor live. */
    leave: (tabId: string) => { active.delete(tabId); live.delete(tabId); tellLive(); },
    closeTab: (tabId: string) => {
      const at = infos.findIndex((info) => info.tabId === tabId);
      if (at >= 0) infos.splice(at, 1);
      active.delete(tabId);
      live.delete(tabId);
      for (const listener of [...tabsListeners]) listener();
    },
    /** The map of `tabId` changes: a token is added (watchers hear it while it is live). */
    addToken: (tabId: string, id: string) => {
      tokensOf.set(tabId, { ...tokensOf.get(tabId), [id]: { id, kind: 'character', x: 140, y: 140, imagePath: 'tokens/hero.png', name: id, resources: {} } });
      for (const listener of [...watchers]) listener();
    },
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

  it('picks up a run that is already going when it starts (ruling 7)', () => {
    const w = world(run('r1', 'k1'));
    expect(w.sender.running()).toBe(true);
    const anna = w.addPlayer('anna');
    w.admit(anna);
    expect(w.of('anna', 'cutscene')).toHaveLength(1);
    w.goLive('a');
    w.ready(anna);
    expect(w.of('anna', 'cutscene-scene')).toHaveLength(1);
  });

  it('follows a live run A, B, A whose maps cover each publication only (ruling 2)', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.goLive('a', 'b');
    const at = (key: string, maps: Record<string, string>, seq: number): GmCutscene => ({ cutscene: run('r1', key, 'live', seq).cutscene, maps });
    w.publish(at('k1', { k1: PATHS.k1 }, 1));
    w.ready(anna);
    w.publish(at('k2', { k2: PATHS.k2 }, 2));
    w.publish(at('k1', { k1: PATHS.k1 }, 3));
    expect(w.of('anna', 'cutscene')).toHaveLength(3);
    expect(w.of('anna', 'cutscene-scene').map((m) => (m as { key: string }).key)).toEqual(['k1', 'k2', 'k1']);
    expect(w.sender.assetsFor('anna')).toBeInstanceOf(Set);
  });

  it('does not send a run whose map key is outside the pattern', () => {
    const w = world();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    w.addPlayer('anna');
    w.publish({ cutscene: run('r1', 'k1').cutscene, maps: { 'k/1': PATHS.k1 } });
    expect(w.sent).toHaveLength(0);
    expect(w.sender.running()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('ends the run for players, with a notice, when a scene cannot be sent at all, and ignores that run from then on', () => {
    const w = world(null, { sceneBytes: 20 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const anna = w.addPlayer('anna');
    w.goLive('a');
    w.ready(anna);
    w.publish(run('r1', 'k1'));
    expect(w.of('anna', 'cutscene-scene')).toHaveLength(0);
    expect(w.of('anna', 'cutscene').at(-1)).toEqual({ v: 1, type: 'cutscene', cutscene: null });
    expect(w.notices).toHaveLength(1);
    expect(w.sender.running()).toBe(false);
    const count = w.sent.length;
    w.publish(run('r1', 'k2', 'prepared', 2));
    vi.advanceTimersByTime(1000);
    expect(w.sent.length).toBe(count);
    expect(w.notices).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    // The next run is carried again (here too large again, so ended again).
    w.publish(null);
    w.publish(run('r2', 'k1'));
    expect(w.notices).toHaveLength(2);
    warn.mockRestore();
  });

  it('waits for the step\'s scene only once the GM is on its map: the run ends when that map is active and sends nothing for 3 s', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.ready(anna);
    w.goLive('a');
    w.publish(run('r1', 'k1'));
    expect(w.of('anna', 'cutscene-scene')).toMatchObject([{ key: 'k1' }]);
    // A step to the tavern: the GM's board is not on it yet (it goes there at the black of the fade), so nothing is waited for.
    w.publish(run('r1', 'k2', 'prepared', 2));
    vi.advanceTimersByTime(10_000);
    expect(w.notices).toHaveLength(0);
    expect(w.sender.running()).toBe(true);
    // The GM's board is on the tavern's tab, but its map never loads: black is never left.
    w.leave('a');
    w.activate('b');
    vi.advanceTimersByTime(STEP_WAIT_MS - 100);
    expect(w.notices).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(w.notices).toHaveLength(1);
    expect(w.of('anna', 'cutscene').at(-1)).toEqual({ v: 1, type: 'cutscene', cutscene: null });
    expect(w.sender.running()).toBe(false);
  });

  it('keeps a run whose cross-map step the GM reaches after a 5 s fade, and sends the new map at the fade\'s black', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.ready(anna);
    w.goLive('a');
    w.publish(run('r1', 'k1'));
    w.publish(run('r1', 'k2', 'prepared', 2));
    // The fade's first half (and any keyframe moves before it): the GM is still on the crypt.
    vi.advanceTimersByTime(5000);
    expect(w.notices).toHaveLength(0);
    // The black: the GM's board goes to the tavern, which loads for a second, then is live.
    w.leave('a');
    w.activate('b');
    vi.advanceTimersByTime(1000);
    w.goLive('b');
    vi.advanceTimersByTime(5000);
    expect(w.notices).toHaveLength(0);
    expect(w.sender.running()).toBe(true);
    expect(w.of('anna', 'cutscene-scene').map((m) => (m as { key: string }).key)).toEqual(['k1', 'k2']);
    expect(w.of('anna', 'cutscene').some((m) => (m as { cutscene: unknown }).cutscene === null)).toBe(false);
  });

  it('ends the run 3 s after a step whose map has no tab, or whose tab is closed while it waits', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.ready(anna);
    w.publish({ cutscene: run('r1', 'k1').cutscene, maps: { k1: 'maps/gone.atlasmap', k2: PATHS.k2 } });
    vi.advanceTimersByTime(STEP_WAIT_MS);
    expect(w.notices).toHaveLength(1);
    expect(w.sender.running()).toBe(false);
    w.publish(null);
    w.goLive('a');
    w.publish(run('r2', 'k1'));
    w.publish(run('r2', 'k2', 'prepared', 2));
    vi.advanceTimersByTime(10_000);
    expect(w.notices).toHaveLength(1);
    w.closeTab('b');
    vi.advanceTimersByTime(STEP_WAIT_MS);
    expect(w.notices).toHaveLength(2);
    expect(w.of('anna', 'cutscene').at(-1)).toEqual({ v: 1, type: 'cutscene', cutscene: null });
  });

  it('sends a map a live run comes back to as it is now, not as it was when the GM left it', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.goLive('a');
    const at = (key: string, maps: Record<string, string>, seq: number): GmCutscene => ({ cutscene: run('r1', key, 'live', seq).cutscene, maps });
    w.publish(at('k1', { k1: PATHS.k1 }, 1));
    w.ready(anna);
    // To the tavern: the crypt's tab is no longer live, and the GM's crypt changes meanwhile.
    w.leave('a');
    w.goLive('b');
    w.publish(at('k2', { k2: PATHS.k2 }, 2));
    w.addToken('a', 'newcomer');
    // Back to the crypt, under its old key.
    w.goLive('a');
    w.publish(at('k1', { k1: PATHS.k1 }, 3));
    const scenes = w.of('anna', 'cutscene-scene') as Array<{ key: string; scene: { tokens: Record<string, unknown> } }>;
    expect(scenes.map((m) => m.key)).toEqual(['k1', 'k2', 'k1']);
    expect(Object.keys(scenes[0]!.scene.tokens)).toEqual([]);
    expect(Object.keys(scenes[2]!.scene.tokens)).toEqual(['newcomer']);
  });

  it('forgets a player who left or was kicked: nothing more is sent and no file is served', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    const ben = w.addPlayer('ben');
    w.goLive('a');
    w.publish(run('r1', 'k1'));
    w.ready(anna);
    w.ready(ben);
    expect(w.sender.assetsFor('ben').size).toBeGreaterThanOrEqual(0);
    w.gone(anna);
    w.kick(ben);
    const count = w.sent.length;
    w.goLive('b');
    expect(w.sent.length).toBe(count);
    expect(w.sender.assetsFor('anna').size).toBe(0);
    expect(w.sender.assetsFor('ben').size).toBe(0);
  });

  it('stop() ends its subscriptions, watchers and timers', () => {
    const w = world();
    const anna = w.addPlayer('anna');
    w.goLive('a');
    w.publish(run('r1', 'k1', 'live'));
    w.ready(anna);
    w.moveCamera(5);
    w.moveCamera(6);
    w.sender.stop();
    expect(w.handlerOn()).toBe(false);
    expect(w.changes.size).toBe(0);
    expect(w.cameras.size).toBe(0);
    expect(w.watchers.size).toBe(0);
    expect(w.sender.running()).toBe(false);
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
