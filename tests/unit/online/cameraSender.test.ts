import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { decodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { CameraSender } from '../../../src/app/online/scene/CameraSender';
import { CAMERA_INTERVAL_MS, type SceneCamera } from '../../../src/app/online/scene/sceneCamera';
import { SceneBroadcaster } from '../../../src/app/online/scene/SceneBroadcaster';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { memoryImageFiles, nodeHash } from './assetFixtures';
import { emptySceneState, FakeViewport, presenter, viewWithViewport, type ViewState as CameraSceneState } from './presentedFixtures';

interface Received { message: ControlMessage; at: number }
type TimedCamera = SceneCamera & { at: number };

function world(state: CameraSceneState = emptySceneState()) {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  const rules: PlayerViewRules = {
    showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true,
  };
  const settings = { getLocalPlayerViewSettings: (): PlayerViewRules => rules, onChange: (): (() => void) => () => {} };
  const presented = presenter();
  const assets = new AssetRegistry({ files: memoryImageFiles().source, notify: () => {}, hash: nodeHash });
  const broadcaster = new SceneBroadcaster({ session: gm, presented, settings, assets, notify: () => {} });
  const sender = new CameraSender({ session: gm, presented, projection: broadcaster });
  broadcaster.start();
  sender.start();
  const viewport = new FakeViewport();
  const scene = viewWithViewport(presented, viewport, state);
  const received = new Map<string, Received[]>();

  const join = async (key: string): Promise<PlayerSession> => {
    const before = requests.length;
    const inner = network.client();
    const log: Received[] = [];
    received.set(key, log);
    const transport: ClientTransport = {
      connect: async (hostId: string): Promise<PeerLink> => {
        const link = await inner.connect(hostId);
        link.onMessage((channel, data) => {
          const decoded = channel === 'control' ? decodeControl(data) : null;
          if (decoded?.kind === 'message') log.push({ message: decoded.message, at: Date.now() });
        });
        return link;
      },
    };
    const player = new PlayerSession({ hostId: 'gm', name: key, playerKey: key, clientVersion: '1', transport, onChange: () => {} });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    if (requests.length > before) gm.allow(requests.at(-1)!.playerId);
    await vi.advanceTimersByTimeAsync(0);
    return player;
  };
  /** The scene messages a player received, by type, in order. */
  const sceneTypes = (key: string): string[] =>
    (received.get(key) ?? []).map(({ message }) => message.type).filter((type) => type.startsWith('scene-'));
  const cameras = (key: string): TimedCamera[] => (received.get(key) ?? []).flatMap(({ message, at }) => (message.type === 'scene-camera'
    ? [{ sceneId: message.sceneId, centerX: message.centerX, centerY: message.centerY, width: message.width, height: message.height, at }]
    : []));
  const sceneId = (): string | null => broadcaster.currentProjection()?.sceneId ?? null;
  return { gm, presented, sender, viewport, ...scene, join, sceneTypes, cameras, sceneId };
}

const untimed = ({ at: _at, ...camera }: TimedCamera): SceneCamera => camera;

describe('CameraSender', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends the GM camera after the snapshot when a scene is presented', async () => {
    const w = world();
    const anna = await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.sceneTypes('anna')).toEqual(['scene-clear', 'scene-snapshot', 'scene-camera']);
    expect(anna.camera).toEqual({ sceneId: w.sceneId(), centerX: 500, centerY: 400, width: 800, height: 600 });
  });

  it('sends nothing while the view does not move', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    for (let frame = 0; frame < 5; frame++) {
      w.viewport.frame();
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(w.cameras('anna')).toHaveLength(1);
  });

  it('sends no camera that players would reject', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    const before = w.cameras('anna').length;
    w.viewport.moveTo(Number.NaN, 400);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    w.viewport.worldScreenWidth = 50_000_000;
    w.viewport.moveTo(10, 10);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    expect(w.cameras('anna')).toHaveLength(before);
  });

  it('sends at most every 100 ms, and the final position after a continuous pan', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    for (let step = 1; step <= 10; step++) {
      w.viewport.moveTo(500 + step * 10, 400);
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    const pan = w.cameras('anna').slice(1);
    expect(pan.length).toBeGreaterThanOrEqual(2);
    expect(pan.length).toBeLessThanOrEqual(3);
    expect(pan.at(-1)?.centerX).toBe(600);
    const gaps = pan.slice(1).map((camera, index) => camera.at - pan[index]!.at);
    expect(gaps.every((gap) => gap >= CAMERA_INTERVAL_MS)).toBe(true);
  });

  it('sends nothing while the GM browses another tab, and the camera once on return', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    w.tabs.getState().setActiveTab(w.dungeon);
    await vi.advanceTimersByTimeAsync(0);
    w.viewport.moveTo(9000, 9000);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS * 3);
    expect(w.cameras('anna')).toHaveLength(1);
    // Back on the presented tab, Atlas restores that tab's view before players see it again.
    w.viewport.center = { x: 520, y: 410 };
    const before = w.sceneTypes('anna').length;
    w.tabs.getState().setActiveTab(w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.sceneTypes('anna').slice(before)).toEqual(['scene-snapshot', 'scene-camera']);
    expect(w.cameras('anna').at(-1)).toMatchObject({ centerX: 520, centerY: 410 });
  });

  it('sends the camera of a presentation made while the map loads once it has loaded', async () => {
    const w = world(emptySceneState(true));
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    w.viewport.moveTo(600, 400);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    expect(w.sceneTypes('anna')).toEqual(['scene-clear']);
    w.store.setState({ isMapLoading: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(w.sceneTypes('anna')).toEqual(['scene-clear', 'scene-snapshot', 'scene-camera']);
    expect(w.cameras('anna')[0]).toMatchObject({ sceneId: w.sceneId(), centerX: 600 });
  });

  it('sends the camera with the snapshot of a player who joins, also while the scene is held', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    const bea = await w.join('bea');
    expect(w.sceneTypes('bea')).toEqual(['scene-snapshot', 'scene-camera']);
    expect(bea.camera).toEqual(untimed(w.cameras('anna').at(-1)!));
    w.tabs.getState().setActiveTab(w.dungeon);
    await vi.advanceTimersByTimeAsync(0);
    w.viewport.moveTo(9000, 9000);
    const cleo = await w.join('cleo');
    expect(w.sceneTypes('cleo')).toEqual(['scene-snapshot', 'scene-camera']);
    expect(cleo.camera).toEqual(bea.camera);
  });

  it('sends the camera again to a player who asks for a snapshot', async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    w.sender.onMessage(w.gm.getPlayers()[0]!, { v: 1, type: 'scene-resync', seq: 0 });
    expect(w.cameras('anna')).toHaveLength(2);
  });

  it("sends no camera once presenting stops, and the new scene's after presenting again", async () => {
    const w = world();
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    const first = w.sceneId();
    w.presented.clear();
    w.viewport.moveTo(700, 400);
    await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS);
    expect(w.cameras('anna')).toHaveLength(1);
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    const cameras = w.cameras('anna');
    expect(cameras).toHaveLength(2);
    expect(cameras[1]?.sceneId).not.toBe(first);
    expect(cameras[1]?.sceneId).toBe(w.sceneId());
  });

  it('stops watching the view when stopped', () => {
    const w = world();
    w.presented.present(w.view, w.tavern);
    expect(w.viewport.listenerCount).toBe(1);
    w.sender.stop();
    expect(w.viewport.listenerCount).toBe(0);
  });
});
