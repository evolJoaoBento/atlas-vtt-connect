/**
 * A remote scene client on FakeAtlas's recorded remote view handle, with a fake session service (or a real one)
 * and manual animation frames.
 */
import { vi } from 'vitest';
import type { AtlasCapability, AtlasExtension } from '@atlas-vtt/api-types';
import type { OnlineSceneSink } from '../../../../src/app/online/obsidian/onlineJoinTypes';
import type { RemoteImages } from '../../../../src/app/online/obsidian/onlineJoinTypes';
import { RemoteSceneClient, type Frames, type RemoteSceneService } from '../../../../src/app/online/obsidian/remote/RemoteSceneClient';
import type { PlayerSessionState } from '../../../../src/app/online/PlayerSession';
import { LASER_PALETTE } from '../../../../src/app/online/tools/laserColors';
import { connectingPlugin, FakeAtlas } from '../../../fake/FakeAtlas';
import type { FakeRemoteHandle } from '../../../fake/fakeRemoteViews';

export const REMOTE_CAPABILITIES: readonly AtlasCapability[] = ['views', 'lasers', 'ui', 'settings', 'tokens', 'remote-view'];

export const admitted = (players: string[] = []): PlayerSessionState => ({
  status: 'admitted', playerId: 'me', title: 'Table', reason: null,
  players: players.map((playerId) => ({ playerId, name: playerId, connected: true })),
});

export interface RemoteSceneSetupOptions {
  /** The fake service finds no joined session. */
  noSession?: boolean;
  laserColor?: string;
  images?: RemoteImages;
  capabilities?: readonly AtlasCapability[];
}

export async function remoteSceneSetup(options: RemoteSceneSetupOptions = {}) {
  const atlas = new FakeAtlas({ capabilities: options.capabilities ?? REMOTE_CAPABILITIES });
  const extension: AtlasExtension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  const view = await extension.remoteViews!.open({ title: 'Online scene', icon: 'network', reuse: true, maxDice: 20 });
  const handle: FakeRemoteHandle = atlas.remoteViews.latest();
  let sink: OnlineSceneSink | null = null;
  const detach = vi.fn();
  const fake = {
    attach: vi.fn((given: OnlineSceneSink) => {
      if (options.noSession) return null;
      sink = given;
      return detach;
    }),
    images: options.images ?? { background: (): string | null => null, token: (): string | null => null },
    reconnect: vi.fn(() => null),
    sendDiceRoll: vi.fn((): boolean => true),
    sendTokenMove: vi.fn((): boolean => true),
    sendLaser: vi.fn((): boolean => true),
    leave: vi.fn(),
  };
  const service: RemoteSceneService = fake;
  const queue = new Map<number, () => void>();
  let nextHandle = 0;
  const frames: Frames = {
    request: (draw) => { const id = ++nextHandle; queue.set(id, draw); return id; },
    cancel: (id) => { queue.delete(id); },
  };
  const has = (capability: AtlasCapability): boolean => atlas.has(capability);
  const client = new RemoteSceneClient({
    view, service, lasers: has('lasers') ? extension.lasers : null, ui: has('ui') ? extension.ui : null,
    laserColor: () => options.laserColor ?? LASER_PALETTE[0]!, frames,
  });
  const attached = client.attach();
  const runFrames = (): void => { const due = [...queue.values()]; queue.clear(); due.forEach((draw) => draw()); };
  return {
    atlas, extension, view, handle, fake, client, attached, detach, runFrames,
    sink: (): OnlineSceneSink => {
      if (!sink) throw new Error('The client did not attach to the fake service');
      return sink;
    },
    pendingFrames: (): number => queue.size,
  };
}
