import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineSessionService, type Deps } from '../../../src/app/online/OnlineSessionService';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import { DEFAULT_ONLINE_SETTINGS } from '../../../src/app/online/onlineSettings';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { decodeAsset, encodeAsset } from '../../../src/app/online/assets/assetProtocol';
import type { ImageFiles } from '../../../src/app/online/scene/AssetRegistry';
import { PeopleBook } from '../../../src/app/online/sharing/people/PeopleBook';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { memorySettings } from '../connect/memorySettings';
import { fingerprintOf } from './assetFixtures';
import { emptySceneState, FakeViewport, presenter, sceneView, viewWithViewport, type Presenter } from './presentedFixtures';
import { createDefaultInitiativeState } from './sceneFixtures';
import { PATHS } from './sharing/sharingPathsFixture';

const app = { workspace: { on: () => ({}), offref: () => {} }, vault: { getName: () => 'My Vault', getAbstractFileByPath: () => null, on: () => ({}), offref: () => {} } } as never;
/** The fork's player page: these fixtures keep its address, so the join link assertions stay the fork's (F12). */
const FORK_PAGE = 'https://evoljoaobento.github.io/atlas-vtt/';
const settings = memorySettings({ playerPageUrl: FORK_PAGE });
const playerViewSettings = {
  getLocalPlayerViewSettings: () => ({
    showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true,
  }),
  onChange: () => () => {},
};

/** What the service reads of Atlas, from a presenter over a fake Atlas. */
function atlasDeps(presented: Presenter = presenter()): Pick<Deps, 'presented' | 'views' | 'playerViewSettings'> {
  return { presented, views: presented.extension.views, playerViewSettings };
}

afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

function service(network = new MemoryNetwork(), presented = presenter(), images?: ImageFiles) {
  const host = network.host('gm-id');
  const notices: Array<{ name: string; answer: (allow: boolean) => void; hidden: boolean }> = [];
  const svc = new OnlineSessionService(app, settings, {
    table: async () => null, createHost: async () => host,
    ...atlasDeps(presented),
    ...(images ? { images } : {}),
    showRequest: (player, answer) => {
      const notice = { name: player.name, answer, hidden: false };
      notices.push(notice);
      return { hide: () => { notice.hidden = true; } };
    },
  });
  return { svc, notices, network, host };
}

describe('OnlineSessionService', () => {
  it('starts hosting with a join link', async () => {
    const { svc } = service();
    await svc.start();
    expect(onlineSessionStore.getState()).toMatchObject({
      status: 'hosting', peerId: 'gm-id', joinUrl: 'https://evoljoaobento.github.io/atlas-vtt/#id=gm-id', error: null,
    });
  });

  it('shows a notice per join request and admits on Allow', async () => {
    const { svc, notices, network } = service();
    await svc.start();
    const link = await network.client().connect('gm-id');
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    expect(notices.map((n) => n.name)).toEqual(['Anna']);
    notices[0]!.answer(true);
    expect(notices[0]!.hidden).toBe(true);
    expect(onlineSessionStore.getState().players).toMatchObject([{ name: 'Anna', status: 'admitted' }]);
  });

  it('hides open notices when the session stops', async () => {
    const { svc, notices, network } = service();
    await svc.start();
    const link = await network.client().connect('gm-id');
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Bob', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    svc.stop();
    expect(notices[0]!.hidden).toBe(true);
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'idle', players: [], joinUrl: null });
  });

  it('reports a failure to start', async () => {
    const svc = new OnlineSessionService(app, settings, {
      table: async () => null, createHost: async () => { throw { code: 'server-error', message: 'Could not reach the signaling server' }; },
      showRequest: () => ({ hide: () => {} }), ...atlasDeps(),
    });
    await svc.start();
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'error', error: 'Could not reach the signaling server' });
  });

  it('keeps hosting when the signaling server hiccups, and clears the note on the next player change', async () => {
    const { svc, host, network } = service();
    await svc.start();
    host.fail({ code: 'network', message: 'Lost connection to the signaling server' });
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'hosting', error: 'Lost connection to the signaling server' });
    const link = await network.client().connect('gm-id');
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Cy', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'hosting', error: null });
  });

  it('keeps hosting but warns when the relay settings are too long for a link', async () => {
    const turnServers = Array.from({ length: 9 }, (_, i) => ({ urls: `turn:t${i}.example.com:3478`, username: 'u', credential: 'c' }));
    const svc = new OnlineSessionService(app, memorySettings({ playerPageUrl: FORK_PAGE, turnServers }), {
      table: async () => null, createHost: async () => new MemoryNetwork().host('gm-id'),
      showRequest: () => ({ hide: () => {} }), ...atlasDeps(),
    });
    await svc.start();
    expect(onlineSessionStore.getState()).toMatchObject({
      status: 'hosting', error: 'Your relay (TURN) settings are too long for a join link — remove some.',
    });
  });

  it('ends in error and closes the host when the player page address is invalid', async () => {
    const host = new MemoryNetwork().host('gm-id');
    const closeSpy = vi.spyOn(host, 'close');
    const svc = new OnlineSessionService(app, memorySettings({ playerPageUrl: 'foo' }), {
      table: async () => null, createHost: async () => host,
      showRequest: () => ({ hide: () => {} }), ...atlasDeps(),
    });
    await expect(svc.start()).resolves.toBeUndefined();
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('valid web address') });
    expect(closeSpy).toHaveBeenCalled();
    expect(svc.session).toBeNull();
  });

  it('stops the session and reports the error when the scene broadcaster cannot start', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm-id');
    const closeSpy = vi.spyOn(host, 'close');
    const presented = presenter();
    vi.spyOn(presented, 'subscribe').mockImplementation(() => { throw new Error('no scene source'); });
    const svc = new OnlineSessionService(app, settings, { table: async () => null, createHost: async () => host, ...atlasDeps(presented), showRequest: () => ({ hide: () => {} }) });
    await expect(svc.start()).resolves.toBeUndefined();
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'error', error: 'no scene source' });
    expect(svc.session).toBeNull();
    expect(closeSpy).toHaveBeenCalled();
    await expect(network.client().connect('gm-id')).rejects.toBeDefined();
    host.fail({ code: 'network', message: 'late' });
    expect(onlineSessionStore.getState().error).toBe('no scene source');
  });

  it('ignores signaling errors after stop', async () => {
    const { svc, host } = service();
    await svc.start();
    svc.stop();
    host.fail({ code: 'network', message: 'late' });
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'idle', error: null });
  });

  it('closes a late host when stopped while starting', async () => {
    const host = new MemoryNetwork().host('gm-id');
    const closeSpy = vi.spyOn(host, 'close');
    let resolve!: (h: typeof host) => void;
    const svc = new OnlineSessionService(app, settings, {
      table: async () => null, createHost: () => new Promise((r) => { resolve = r; }),
      showRequest: () => ({ hide: () => {} }), ...atlasDeps(),
    });
    const started = svc.start();
    svc.stop();
    resolve(host);
    await started;
    expect(closeSpy).toHaveBeenCalled();
    expect(onlineSessionStore.getState().status).toBe('idle');
    expect(svc.session).toBeNull();
  });

  it('holds the session before it says it is hosting, so a stop from a store listener stops it', async () => {
    const host = new MemoryNetwork().host('gm-id');
    const closeSpy = vi.spyOn(host, 'close');
    const svc = new OnlineSessionService(app, settings, {
      table: async () => null, createHost: async () => host, showRequest: () => ({ hide: () => {} }), ...atlasDeps(),
    });
    const unsubscribe = onlineSessionStore.subscribe((state) => { if (state.status === 'hosting') svc.stop(); });
    await svc.start();
    unsubscribe();
    expect(svc.session).toBeNull();
    expect(closeSpy).toHaveBeenCalled();
    expect(onlineSessionStore.getState().status).toBe('idle');
  });

  it('does not report a late failure after stop', async () => {
    let reject!: (e: unknown) => void;
    const svc = new OnlineSessionService(app, settings, {
      table: async () => null, createHost: () => new Promise((_, r) => { reject = r; }),
      showRequest: () => ({ hide: () => {} }), ...atlasDeps(),
    });
    const started = svc.start();
    svc.stop();
    reject(null);
    await started;
    expect(onlineSessionStore.getState().status).toBe('idle');
  });

  it('sends the presented scene to joining players, even one presented before the session started', async () => {
    const presented = presenter();
    const { view, tavern: tabId } = sceneView(presented, {
      background: null, grid: null, isMapLoading: false, widgetValues: {}, initiativeTrackerOpen: false,
      initiative: createDefaultInitiativeState(),
      widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
      objects: {
        tokens: { t: { id: 't', kind: 'token', x: 10, y: 10, imagePath: 'a.png' } },
        fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {},
      },
    });
    presented.present(view, tabId);
    const { svc, notices, network } = service(new MemoryNetwork(), presented);
    await svc.start();
    const link = await network.client().connect('gm-id');
    const received: string[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message.type);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    notices[0]!.answer(true);
    expect(received).toContain('scene-snapshot');
    svc.stop();
    presented.clear();
    expect(received.filter((type) => type === 'scene-clear')).toEqual([]);
  });

  it("sends the GM's camera of the presented scene to the players it admits, and stops watching on stop", async () => {
    const presented = presenter();
    const viewport = new FakeViewport();
    const { view, tavern } = viewWithViewport(presented, viewport);
    presented.present(view, tavern);
    const { svc, notices, network } = service(new MemoryNetwork(), presented);
    await svc.start();
    const link = await network.client().connect('gm-id');
    const received: string[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message.type);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    notices[0]!.answer(true);
    expect(received.filter((type) => type.startsWith('scene-'))).toEqual(['scene-snapshot', 'scene-camera']);
    svc.stop();
    expect(viewport.listenerCount).toBe(0);
  });

  it('disposes the image registry when the session stops', async () => {
    const stop = vi.fn();
    const images = { stat: () => null, read: async (): Promise<ArrayBuffer> => new ArrayBuffer(0), onChange: () => stop };
    const host = new MemoryNetwork().host('gm-id');
    const svc = new OnlineSessionService(app, settings, {
      table: async () => null, createHost: async () => host, ...atlasDeps(), images, showRequest: () => ({ hide: () => {} }),
    });
    await svc.start();
    expect(stop).not.toHaveBeenCalled();
    svc.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('serves the presented scene\'s images to the players it admitted', async () => {
    const map = new TextEncoder().encode('map image bytes');
    const images: ImageFiles = {
      stat: (path) => (path === 'maps/cave.png' ? { size: map.byteLength, mtime: 1 } : null),
      read: async () => map.slice().buffer,
    };
    const presented = presenter();
    const { view, tavern: tabId } = sceneView(presented, {
      background: 'maps/cave.png', grid: null, isMapLoading: false, widgetValues: {}, initiativeTrackerOpen: false,
      initiative: createDefaultInitiativeState(),
      widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
      objects: { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {} },
    });
    presented.present(view, tabId);
    const { svc, notices, network } = service(new MemoryNetwork(), presented, images);
    await svc.start();
    const link = await network.client().connect('gm-id');
    let mapAsset: string | null = null;
    const assetKinds: string[] = [];
    link.onMessage((channel, data) => {
      if (channel === 'assets') {
        const decoded = decodeAsset(data);
        assetKinds.push(decoded.kind === 'message' ? decoded.message.type : decoded.kind);
        return;
      }
      const decoded = decodeControl(data);
      if (decoded.kind !== 'message') return;
      if (decoded.message.type === 'scene-snapshot') mapAsset = decoded.message.scene.map.asset;
      if (decoded.message.type === 'scene-patch' && decoded.message.set.map) mapAsset = decoded.message.set.map.asset;
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    notices[0]!.answer(true);

    const id = fingerprintOf(map);
    await vi.waitFor(() => expect(mapAsset).toBe(id));
    link.send('assets', encodeAsset({ v: 1, type: 'asset-request', ids: [id] }));
    await vi.waitFor(() => expect(assetKinds).toEqual(['asset-start', 'chunk', 'asset-end']));
    svc.stop();
    presented.clear();
  });

  it('logs players and scene messages to the console while Log online play events is on', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logging = memorySettings({ ...DEFAULT_ONLINE_SETTINGS, logEvents: true });
    const network = new MemoryNetwork();
    const host = network.host('gm-id');
    const notices: Array<(allow: boolean) => void> = [];
    const svc = new OnlineSessionService(app, logging, {
      table: async () => null, createHost: async () => host, ...atlasDeps(),
      showRequest: (_player, answer) => { notices.push(answer); return { hide: () => {} }; },
    });
    await svc.start();
    const link = await network.client().connect('gm-id');
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    notices[0]!(true);
    const events = debug.mock.calls.map((call) => call[1]);
    expect(events).toContain('players');
    expect(events).toContain('send scene-clear');
    svc.stop();
    debug.mockRestore();
  });

  // 'lets admitted players move the tokens the GM assigns, until they are removed or the session stops' needs the
  // token control host and its moves (plan B10).

  it("sends the measurement of the presented map's collection", async () => {
    const presented = presenter();
    const { view, tavern } = viewWithViewport(presented, null, { ...emptySceneState(), mapPath: 'maps/tavern.atlasmap' });
    presented.present(view, tavern);
    const network = new MemoryNetwork();
    const host = network.host('gm-id');
    const answers: Array<(allow: boolean) => void> = [];
    const asked: Array<string | null> = [];
    const svc = new OnlineSessionService(app, settings, {
      table: async () => null, createHost: async () => host,
      ...atlasDeps(presented),
      showRequest: (_player, answer) => { answers.push(answer); return { hide: () => {} }; },
      collectionGrid: (mapPath) => {
        asked.push(mapPath);
        return { unitType: 'meters', unitDistance: 1.5, measurementMode: 'metric', diagonalRule: 'euclidean' };
      },
      // The GM's own cone angle for the map (`mapConeAngle`), not the grid defaults'.
      coneAngle: (mapPath) => (mapPath === 'maps/tavern.atlasmap' ? 53.13 : 90),
    });
    await svc.start();
    const link = await network.client().connect('gm-id');
    const received: ControlMessage[] = [];
    link.onMessage((_channel, data) => {
      const decoded = decodeControl(data);
      if (decoded.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'Anna', playerKey: 'k', client: { kind: 'web', version: '1' } }));
    answers[0]!(true);
    const snapshot = received.find((message) => message.type === 'scene-snapshot') as Extract<ControlMessage, { type: 'scene-snapshot' }>;
    expect(snapshot.scene.measurement).toEqual({ mode: 'metric', unitType: 'meters', unitDistance: 1.5, diagonalRule: 'euclidean', rangeBands: [], snapToGrid: true, coneAngle: 53.13,
      snapGrid: { type: 'square', size: 70, offsetX: 0, offsetY: 0 },
    });
    expect(asked).toContain('maps/tavern.atlasmap');
    svc.stop();
  });

  // "rolls admitted players' dice and relays the dice log while hosting, and stops listening on stop" needs the
  // dice host (plan B7).

  it('does not host while this Atlas is in a session it joined', async () => {
    const createHost = vi.fn();
    const svc = new OnlineSessionService(app, settings, { table: async () => null, createHost, isJoined: () => true, ...atlasDeps() });
    await svc.start();
    expect(createHost).not.toHaveBeenCalled();
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'error', error: 'Leave the online session you joined before hosting one.' });
  });

  it('puts the table id in the link when it has a table key', async () => {
    const network = new MemoryNetwork();
    const host = network.host('gm-id');
    const svc = new OnlineSessionService(app, settings, {
      createHost: async () => host, ...atlasDeps(), showRequest: () => ({ hide: () => {} }),
      // The table goes with the people list: without one the session hosts without sharing.
      people: PeopleBook.forApp(createInMemoryApp().app, PATHS),
      table: async () => ({ id: 'T'.repeat(43), keys: { publicKey: 'k', privateKey: {} } }),
    });
    await svc.start();
    expect(onlineSessionStore.getState().joinUrl).toBe(`https://evoljoaobento.github.io/atlas-vtt/#id=gm-id&table=${'T'.repeat(43)}`);
    expect(svc.table?.id).toBe('T'.repeat(43));
    expect(svc.hostId).toBe('gm-id');
    svc.stop();
    expect(svc.table).toBeNull();
  });
});
