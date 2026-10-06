import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { RESYNC_MIN_INTERVAL_MS } from '../../../src/app/online/scene/PlayerSceneMirror';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import { playerScene, playerToken, sceneBody } from './sceneFixtures';

interface Harness {
  gm: GmSession;
  player: PlayerSession;
  playerId: string;
  fromPlayer: ControlMessage[];
  scenes: Array<PlayerScene | null>;
}

async function admittedPlayer(): Promise<Harness> {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  const fromPlayer: ControlMessage[] = [];
  gm.use({ onMessage: (_player, message) => fromPlayer.push(message) });
  const scenes: Array<PlayerScene | null> = [];
  const player = new PlayerSession({
    hostId: 'gm', name: 'Anna', playerKey: 'key-a', clientVersion: '1', transport: network.client(),
    onChange: () => {}, onScene: (scene) => scenes.push(scene),
  });
  player.start();
  await vi.advanceTimersByTimeAsync(0);
  const playerId = requests[0]!.playerId;
  gm.allow(playerId);
  return { gm, player, playerId, fromPlayer, scenes };
}

describe('PlayerSession scenes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the snapshot and patches the GM sends', async () => {
    const { gm, player, playerId, scenes } = await admittedPlayer();
    const scene = playerScene();
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 1, drawingParts: 1 });
    gm.send(playerId, { v: 1, type: 'scene-fog', seq: 2, part: 0, records: scene.fog });
    gm.send(playerId, { v: 1, type: 'scene-drawings', seq: 3, part: 0, records: scene.drawings });
    expect(scenes.at(-1)).toEqual(scene);
    gm.send(playerId, { v: 1, type: 'scene-patch', seq: 4, set: {}, upsert: { tokens: { t1: playerToken({ x: 300 }) } }, remove: {} });
    expect(player.scene?.tokens.t1?.x).toBe(300);
  });

  it('asks the GM for a snapshot after a gap', async () => {
    const { gm, player, playerId, fromPlayer } = await admittedPlayer();
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(playerScene()), fogParts: 0, drawingParts: 0 });
    gm.send(playerId, { v: 1, type: 'scene-patch', seq: 3, set: {}, upsert: {}, remove: { tokens: ['t1'] } });
    expect(player.scene?.tokens.t1).toBeDefined();
    expect(fromPlayer).toEqual([{ v: 1, type: 'scene-resync', seq: 1 }]);
  });

  it('answers invalid scene messages with a resync, at most once per second', async () => {
    const { gm, playerId, fromPlayer } = await admittedPlayer();
    const broken = { v: 1, type: 'scene-patch', seq: 1, set: {}, upsert: { tokens: { t1: { x: 'left' } } }, remove: {} } as unknown as ControlMessage;
    gm.send(playerId, broken);
    gm.send(playerId, broken);
    expect(fromPlayer).toEqual([{ v: 1, type: 'scene-resync', seq: 0 }]);
    await vi.advanceTimersByTimeAsync(RESYNC_MIN_INTERVAL_MS);
    expect(fromPlayer).toHaveLength(2);
  });

  it('shows nothing once the GM clears the scene', async () => {
    const { gm, player, playerId, scenes } = await admittedPlayer();
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(playerScene()), fogParts: 0, drawingParts: 0 });
    gm.send(playerId, { v: 1, type: 'scene-clear', seq: 2 });
    expect(player.scene).toBeNull();
    expect(scenes.at(-1)).toBeNull();
  });

  it('keeps the GM camera, whatever its scene', async () => {
    const { gm, player, playerId } = await admittedPlayer();
    gm.send(playerId, { v: 1, type: 'scene-camera', sceneId: 'later', centerX: 1, centerY: 2, width: 3, height: 4 });
    expect(player.camera).toEqual({ sceneId: 'later', centerX: 1, centerY: 2, width: 3, height: 4 });
  });

  it('skips an invalid camera without asking for a snapshot', async () => {
    const { gm, player, playerId, fromPlayer } = await admittedPlayer();
    gm.send(playerId, { v: 1, type: 'scene-camera', sceneId: 's', centerX: 0, centerY: 0, width: 0, height: 4 });
    expect(player.camera).toBeNull();
    expect(fromPlayer).toEqual([]);
  });

  it('shows the paused banner for the shown scene and hides it when live again', async () => {
    const { gm, player, playerId } = await admittedPlayer();
    const scene = playerScene();
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    expect(player.paused).toBe(false);
    gm.send(playerId, { v: 1, type: 'scene-state', sceneId: scene.sceneId, paused: true });
    expect(player.paused).toBe(true);
    gm.send(playerId, { v: 1, type: 'scene-state', sceneId: scene.sceneId, paused: false });
    expect(player.paused).toBe(false);
  });

  it('ignores a scene-state for another sceneId', async () => {
    const { gm, player, playerId } = await admittedPlayer();
    gm.send(playerId, { v: 1, type: 'scene-state', sceneId: 'aaaaaaaaaaaaaaaaaaaaaa', paused: true });
    expect(player.paused).toBe(false);
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(playerScene()), fogParts: 0, drawingParts: 0 });
    gm.send(playerId, { v: 1, type: 'scene-state', sceneId: 'aaaaaaaaaaaaaaaaaaaaaa', paused: true });
    expect(player.paused).toBe(false);
  });

  it('a new scene clears the banner', async () => {
    const { gm, player, playerId } = await admittedPlayer();
    const first = playerScene();
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(first), fogParts: 0, drawingParts: 0 });
    gm.send(playerId, { v: 1, type: 'scene-state', sceneId: first.sceneId, paused: true });
    gm.send(playerId, { v: 1, type: 'scene-clear', seq: 2 });
    expect(player.paused).toBe(false);
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 3, scene: sceneBody(first), fogParts: 0, drawingParts: 0 });
    gm.send(playerId, { v: 1, type: 'scene-state', sceneId: first.sceneId, paused: true });
    const second = { ...first, sceneId: 'bbbbbbbbbbbbbbbbbbbbbb' };
    gm.send(playerId, { v: 1, type: 'scene-snapshot', seq: 4, scene: sceneBody(second), fogParts: 0, drawingParts: 0 });
    expect(player.paused).toBe(false);
  });
});
