import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import type { ControlMessage } from '../../../src/app/online/protocol';
import type { BoardCutscene, BoardExtras } from '../../../src/app/online/scene/boardTypes';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import { playerScene } from './sceneFixtures';

const run: BoardCutscene = {
  runId: 'run1', mode: 'prepared', look: { bars: 2.39, fadeMs: 600 },
  shots: [{ key: 'k1', eye: { x: 0, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 }, at: 0, keyframe: false, transition: 'fade' }],
  step: { shot: 0, seq: 1 }, key: 'k1',
};

const extras = (walls: number): BoardExtras => ({
  sceneId: 's1',
  walls: Array.from({ length: walls }, (_, i) => ({ id: `w${i}`, type: 'solid' as const, p1: { x: i, y: 0 }, p2: { x: i + 1, y: 0 }, height: null, material: null })),
  lights: [], props: [], materials: [], fogHeight: null, wallThickness: null,
  lighting: { enabled: false, ambient: 1, ambientColor: null },
});

async function world() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), { title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {} });
  gm.start();
  const fromPlayer: ControlMessage[] = [];
  gm.use({ onMessage: (_player, message) => fromPlayer.push(message) });
  const heard: string[] = [];
  const runs: Array<BoardCutscene | null> = [];
  const wholes: BoardExtras[] = [];
  const player = new PlayerSession({
    hostId: 'gm', name: 'Anna', playerKey: 'key-a', clientVersion: '1', transport: network.client(),
    onChange: () => {},
    onCutscene: (cutscene) => { runs.push(cutscene); heard.push(cutscene ? 'cutscene' : 'null'); },
    onCutsceneScene: (runId, key) => heard.push(`scene:${runId}:${key}`),
    onCutsceneExtras: (_runId, _key, whole) => wholes.push(whole),
    onCutsceneCamera: (runId) => heard.push(`camera:${runId}`),
  });
  player.start();
  await vi.advanceTimersByTimeAsync(0);
  const playerId = requests[0]!.playerId;
  gm.allow(playerId);
  await vi.advanceTimersByTimeAsync(0);
  const send = async (message: ControlMessage) => { gm.send(playerId, message); await vi.advanceTimersByTimeAsync(0); };
  const links = (): Array<{ close(): void }> => [...(gm as unknown as { links: Map<{ close(): void }, unknown> }).links.keys()];
  return { gm, player, playerId, fromPlayer, heard, runs, wholes, send, links };
}

describe('PlayerSession cutscenes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a cutscene, its scene and its camera reach the options', async () => {
    const w = await world();
    await w.send({ v: 1, type: 'cutscene', cutscene: run });
    await w.send({ v: 1, type: 'cutscene-scene', runId: 'run1', key: 'k1', scene: playerScene() });
    await w.send({ v: 1, type: 'cutscene-camera', runId: 'run1', eye: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } });
    expect(w.heard).toEqual(['cutscene', 'scene:run1:k1', 'camera:run1']);
    expect(w.runs[0]).toEqual(run);
  });

  it('extras in 3 parts reach onCutsceneExtras once, whole', async () => {
    const w = await world();
    await w.send({ v: 1, type: 'cutscene', cutscene: run });
    const whole = extras(3);
    const part = (n: number) => ({ ...whole, walls: whole.walls.slice(n, n + 1) });
    await w.send({ v: 1, type: 'cutscene-extras', runId: 'run1', key: 'k1', seq: 2, part: 2, parts: 3, extras: part(2) });
    await w.send({ v: 1, type: 'cutscene-extras', runId: 'run1', key: 'k1', seq: 2, part: 0, parts: 3, extras: part(0) });
    expect(w.wholes).toEqual([]);
    await w.send({ v: 1, type: 'cutscene-extras', runId: 'run1', key: 'k1', seq: 2, part: 1, parts: 3, extras: part(1) });
    expect(w.wholes).toHaveLength(1);
    expect(w.wholes[0]!.walls.map((wall) => wall.id)).toEqual(['w0', 'w1', 'w2']);
  });

  it('a cutscene of null ends it', async () => {
    const w = await world();
    await w.send({ v: 1, type: 'cutscene', cutscene: run });
    await w.send({ v: 1, type: 'cutscene', cutscene: null });
    expect(w.heard).toEqual(['cutscene', 'null']);
  });

  it('disconnect ends the cutscene: the link closing calls onCutscene(null), and so does a bye', async () => {
    const w = await world();
    await w.send({ v: 1, type: 'cutscene', cutscene: run });
    w.links()[0]!.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.runs).toEqual([run, null]);
    expect(w.player.state.status).toBe('connecting');

    const b = await world();
    await b.send({ v: 1, type: 'cutscene', cutscene: run });
    await b.send({ v: 1, type: 'bye', reason: 'ended' });
    expect(b.runs).toEqual([run, null]);
    expect(b.player.state.status).toBe('lost');
  });

  it('leaving ends the cutscene too, and a Reconnect that closes the link by hand', async () => {
    const w = await world();
    await w.send({ v: 1, type: 'cutscene', cutscene: run });
    w.player.stop();
    expect(w.runs).toEqual([run, null]);

    const r = await world();
    await r.send({ v: 1, type: 'cutscene', cutscene: run });
    // Reconnect only after the player was let in and lost the link; it closes the old link itself.
    expect(r.player.reconnect()).toBe(true);
    expect(r.runs).toEqual([run, null]);
  });

  it('tells nobody twice, and nothing when no cutscene ran', async () => {
    const w = await world();
    w.links()[0]!.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.runs).toEqual([]);
  });

  it('cutscene-ready goes to the GM, and again on every connect, not only the first', async () => {
    const w = await world();
    expect(w.player.sendCutsceneReady(true)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    const ready = (): ControlMessage[] => w.fromPlayer.filter((message) => message.type === 'cutscene-ready');
    expect(ready()).toEqual([{ v: 1, type: 'cutscene-ready', on: true }]);
    // The link drops; the player is let in again on the retry and asks again.
    w.links()[0]!.close();
    await vi.advanceTimersByTimeAsync(1000);
    w.gm.allow(w.playerId);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.player.state.status).toBe('admitted');
    expect(ready()).toHaveLength(2);
    // Asking not to be sent them is remembered too.
    w.player.sendCutsceneReady(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(ready().at(-1)).toEqual({ v: 1, type: 'cutscene-ready', on: false });
    w.links()[0]!.close();
    await vi.advanceTimersByTimeAsync(2000);
    w.gm.allow(w.playerId);
    await vi.advanceTimersByTimeAsync(0);
    expect(ready()).toHaveLength(3);
  });

  it('cannot ask before it is in', async () => {
    const network = new MemoryNetwork();
    const player = new PlayerSession({ hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {} });
    expect(player.sendCutsceneReady(true)).toBe(false);
  });
});
