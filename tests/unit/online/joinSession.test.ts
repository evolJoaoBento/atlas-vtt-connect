import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeControl } from '../../../src/app/online/protocol';
import { createJoinSession, type SceneImageLoader } from '../../../src/app/online/preview/joinSession';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { sceneBody, sceneWithImages } from './sceneFixtures';

describe('createJoinSession', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('gives the loader the assets channel and forwards every scene to it before the page', async () => {
    const network = new MemoryNetwork();
    const gmEnds: PeerLink[] = [];
    network.host('gm').onConnection((link) => gmEnds.push(link));
    const events: string[] = [];
    const scenes: Array<PlayerScene | null> = [];
    const loader: SceneImageLoader = {
      connected: () => events.push('connected'),
      receive: (data) => events.push(`data:${String(data)}`),
      disconnected: () => events.push('disconnected'),
      setScene: (scene) => { scenes.push(scene); events.push('loader-scene'); },
    };
    const session = createJoinSession({
      hostId: 'gm', name: 'A', playerKey: 'k', clientVersion: '1', transport: network.client(), onChange: () => {},
      loader, onScene: () => events.push('page-scene'),
    });
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    const gm = gmEnds[0]!;
    gm.send('control', encodeControl({ v: 1, type: 'admitted', playerId: 'p1', session: { title: 'Table' } }));
    gm.send('assets', 'chunk');
    expect(events).toEqual(['connected', 'data:chunk']);

    const scene = sceneWithImages('m'.repeat(43), []);
    gm.send('control', encodeControl({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 }));
    expect(events.slice(2)).toEqual(['loader-scene', 'page-scene']);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.map.asset).toBe(scene.map.asset);
    session.stop();
  });
});
