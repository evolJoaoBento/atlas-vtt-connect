import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { sharingLifetime } from '../../../src/app/online/sharing/sharingLifetime';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { AtlasLink, STOCK_GRACE_MS } from '../../../src/connect/atlasLink';
import { startConnect } from '../../../src/connect/startConnect';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import { setupStockAtlas } from '../../fake/fakeStockAtlas';
import { fakeEvents } from '../../fake/fakeWorkspace';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import realScene from '../../fake/realStockScene.json';
import { FakeController, REAL } from '../../fake/fakeStockLighting';
import { hostPlugin } from './hostingFixtures';
import { memorySettings } from './memorySettings';

/** Connect hosting through the stand-in for a stock Atlas: no extension API anywhere, only what stock Atlas leaves reachable. */
function stockHosting() {
  const stock = setupStockAtlas();
  const vault = createInMemoryApp({ files: {} }).app;
  const vaultEvents = fakeEvents();
  const cacheEvents = fakeEvents();
  Object.assign(stock.app, {
    vault: Object.assign(vault.vault, { getName: () => 'Vault', on: vaultEvents.on, offref: vaultEvents.offref }),
    metadataCache: Object.assign(vault.metadataCache, { on: cacheEvents.on, offref: cacheEvents.offref }),
  });
  const connect = hostPlugin(stock.app);
  const network = new MemoryNetwork();
  const memoryHost = network.host('gm-id');
  const requests: Array<(allow: boolean) => void> = [];
  const link = new AtlasLink(connect.plugin, (extension, api) => startConnect(connect.plugin, extension, api, {
    settings: memorySettings(),
    lifetime: sharingLifetime(connect.plugin),
    hosting: {
      createHost: async () => memoryHost,
      table: async () => null,
      showRequest: (_player, answer) => { requests.push(answer); return { hide: () => {} }; },
    },
  }), () => undefined);
  link.start();
  const join = async (name: string) => {
    const client = await network.client().connect('gm-id');
    const received: ControlMessage[] = [];
    client.onMessage((channel, data) => {
      const decoded = channel === 'control' && typeof data === 'string' ? decodeControl(data) : null;
      if (decoded?.kind === 'message') received.push(decoded.message);
    });
    client.send('control', encodeControl({ v: 1, type: 'join', name, playerKey: `key-${name}`, client: { kind: 'web', version: '1' } }));
    requests.at(-1)?.(true);
    return received;
  };
  return { ...stock, connect, link, join };
}

describe('hosting on a stock Atlas through the stand-in', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

  it('starts hosting and sends the presented scene to a joined player', async () => {
    const { connect, join, a, presented } = stockHosting();
    await vi.advanceTimersByTimeAsync(STOCK_GRACE_MS);
    expect(connect.run('start-online-session')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineSessionStore.getState().status).toBe('hosting');
    // Players do not get a player window opened for them while online play shows the scene.
    expect(presented.elsewhere()).toBe(1);
    const received = await join('Ana');
    a.scene.set({ objects: { tokens: { a: { id: 'a', kind: 'token', x: 70, y: 70, imagePath: 'art/a.png' } }, texts: {}, drawings: {}, fog: {} } } as never);
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap' });
    await vi.advanceTimersByTimeAsync(80);
    const snapshot = received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot?.type === 'scene-snapshot' && Object.keys(snapshot.scene.tokens)).toEqual(['a']);
  });

  it('shows players nothing of a scene saved lit whose lighting Atlas does not give (fails closed)', async () => {
    const { connect, join, a, presented } = stockHosting();
    await vi.advanceTimersByTimeAsync(STOCK_GRACE_MS);
    connect.run('start-online-session');
    await vi.advanceTimersByTimeAsync(0);
    const received = await join('Ana');
    a.scene.set({
      lighting: { enabled: true },
      objects: { tokens: { a: { id: 'a', kind: 'token', x: 70, y: 70, imagePath: 'art/a.png' } }, texts: {}, drawings: {}, fog: {} },
    } as never);
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap' });
    await vi.advanceTimersByTimeAsync(80);
    const snapshot = received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot).toBeDefined();
    expect(snapshot?.type === 'scene-snapshot' && Object.keys(snapshot.scene.tokens)).toEqual([]);
  });

  /** A lit scene as a stock Atlas 0.8.0 lights it (real sight, light and perception), with `perception` deciding which tokens the players' frame shows. */
  async function litHosting(perception: Record<string, string>, atlas091 = false) {
    const hosting = stockHosting();
    const { connect, join, a, presented, atlas } = hosting;
    // Atlas 0.9.1 has no lighting experiment: asked about it, it says off whatever the scene. Before, it was switched on.
    (atlas.settingsService as unknown as { isExperimentalOn: (id: string) => boolean }).isExperimentalOn = (id) => !atlas091 && id === 'dynamicLighting';
    if (atlas091) Object.assign(atlas, { manifest: { version: '0.9.1' } });
    const controller = new FakeController({ enabled: true, current: true, sight: structuredClone(REAL.sight), ambient: structuredClone(REAL.ambient), reaches: structuredClone(REAL.reaches) });
    Object.assign(a.view.renderer, {
      ...(atlas091 ? { lighting: controller } : { lightingFeature: { controller } }),
      getTokenRenderer: () => ({ playerFramePerception: () => (id: string) => perception[id] }),
    });
    await vi.advanceTimersByTimeAsync(STOCK_GRACE_MS);
    connect.run('start-online-session');
    await vi.advanceTimersByTimeAsync(0);
    const received = await join('Ana');
    a.scene.set({ ...realScene, lighting: { enabled: true, ambient: 0.1 } } as never);
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap' });
    await vi.advanceTimersByTimeAsync(300);
    return { ...hosting, controller, received };
  }

  it("sends the tokens the players' frame shows of a lit scene, and the darkness Atlas's lighting gives", async () => {
    const ids = Object.keys(realScene.objects.tokens);
    const { received } = await litHosting({ [ids[0]!]: 'seen', [ids[1]!]: 'unseen' });
    const snapshot = received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot).toBeDefined();
    expect(snapshot?.type === 'scene-snapshot' && Object.keys(snapshot.scene.tokens)).toHaveLength(1);
  });

  it("on Atlas 0.9.1 (lighting standard, no experiment) still sends only the tokens the players' frame shows of a lit scene", async () => {
    const ids = Object.keys(realScene.objects.tokens);
    const { received } = await litHosting({ [ids[0]!]: 'seen', [ids[1]!]: 'unseen' }, true);
    const snapshot = received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot).toBeDefined();
    expect(snapshot?.type === 'scene-snapshot' && Object.keys(snapshot.scene.tokens)).toHaveLength(1);
  });

  it("stops sending a lit scene the moment Atlas's sight is not the scene's, and sends it again when it is", async () => {
    const ids = Object.keys(realScene.objects.tokens);
    const { received, controller, a } = await litHosting({ [ids[0]!]: 'seen', [ids[1]!]: 'seen' });
    const sceneId = (): string | undefined => {
      const found = received.filter((message) => message.type === 'scene-snapshot' || message.type === 'scene-patch').at(-1);
      return found && 'scene' in found ? found.scene.sceneId : undefined;
    };
    expect(sceneId()).toBeDefined();
    const before = received.length;
    controller.parts.current = false;
    controller.onSightChange();
    a.scene.set({ initiativeTrackerOpen: true } as never);
    await vi.advanceTimersByTimeAsync(300);
    const during = received.slice(before).flatMap((message) => (message.type === 'scene-snapshot' ? Object.keys(message.scene.tokens) : []));
    expect(during).toEqual([]);
    controller.parts.current = true;
    controller.onSightChange();
    await vi.advanceTimersByTimeAsync(300);
    expect(received.length).toBeGreaterThan(before);
  });

  it('stops cleanly when Connect unloads: no player window block, no timers', async () => {
    const { connect, presented } = stockHosting();
    await vi.advanceTimersByTimeAsync(STOCK_GRACE_MS);
    connect.run('start-online-session');
    await vi.advanceTimersByTimeAsync(0);
    connect.unload();
    expect(presented.elsewhere()).toBe(0);
    expect(onlineSessionStore.getState().status).toBe('idle');
  });

  it('sends a scene read from a real stock Atlas 0.7.1 map (tokens, grid, widgets as that Atlas saved them)', async () => {
    const { connect, join, a, presented } = stockHosting();
    await vi.advanceTimersByTimeAsync(STOCK_GRACE_MS);
    connect.run('start-online-session');
    await vi.advanceTimersByTimeAsync(0);
    const received = await join('Ana');
    a.scene.set({ ...realScene } as never);
    presented.set({ tabId: 't1', filePath: 'maps/one.atlasmap' });
    await vi.advanceTimersByTimeAsync(80);
    const snapshot = received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot?.type === 'scene-snapshot' && Object.keys(snapshot.scene.tokens).length).toBe(2);
  });
});
