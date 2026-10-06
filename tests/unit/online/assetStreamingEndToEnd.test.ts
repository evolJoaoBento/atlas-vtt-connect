import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { AssetCache, type ImageStore } from '../../../src/app/online/assets/AssetCache';
import { ASSET_LIMITS } from '../../../src/app/online/assets/assetIds';
import { AssetLoader, type DecodedImage } from '../../../src/app/online/assets/AssetLoader';
import { decodeAsset, type AssetMessage } from '../../../src/app/online/assets/assetProtocol';
import { AssetServer } from '../../../src/app/online/assets/AssetServer';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { SCENE_TICK_MS, SceneHub } from '../../../src/app/online/scene/SceneHub';
import { SceneAssignments } from '../../../src/app/online/split/SceneAssignments';
import { MemoryNetwork, type MemoryLink } from '../../fake/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { presenter, sceneView, type ViewState } from './presentedFixtures';
import { createDefaultInitiativeState } from './sceneFixtures';
import { fingerprintOf, imageBytes, memoryImageFiles, MemoryStore, nodeHash, type MemoryImageFiles } from './assetFixtures';

type SceneState = ViewState;
type Objects = SceneState['objects'];

const MB = 1024 * 1024;
const RULES: PlayerViewRules = {
  showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true,
};
const MAP = imageBytes(300_000, 1);
const HERO = imageBytes(1000, 2);
const GOBLIN = imageBytes(1000, 3);
/** Two tokens share the hero's art; the goblin is completely under fog. */
const TAVERN = {
  hero: { x: 140, y: 140, imagePath: 'art/hero.png' },
  twin: { x: 300, y: 140, imagePath: 'art/hero.png' },
  goblin: { x: 1050, y: 1050, imagePath: 'art/goblin.png' },
};

function objects(tokens: Record<string, { x: number; y: number; imagePath: string }>): Objects {
  const records = Object.fromEntries(Object.entries(tokens).map(([id, token]) => [id, { id, kind: 'token', ...token }]));
  return {
    tokens: records as unknown as Objects['tokens'],
    fog: { f1: { id: 'f1', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 900, y: 900, width: 400, height: 400 } },
    pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {},
  } as Objects;
}

function sceneState(background: string, sceneObjects: Objects): SceneState {
  return {
    background,
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 } as SceneState['grid'],
    objects: sceneObjects,
    widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {},
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    isMapLoading: false,
  };
}

function patchToken(store: StoreApi<SceneState>, id: string, patch: object): void {
  store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, [id]: { ...state.objects.tokens[id]!, ...patch } } } }));
}

/** Decoding without a canvas: the "image" holds the bytes, so tests compare them with the GM's file. */
async function decode(bytes: ArrayBuffer): Promise<DecodedImage> {
  return { image: { bytes: new Uint8Array(bytes) } as unknown as ImageBitmap, width: 1, height: 1, release: () => {} };
}

function shown(loader: AssetLoader, id: string | null | undefined): Uint8Array | null {
  const image = id ? loader.image(id)?.image : undefined;
  return image ? (image as unknown as { bytes: Uint8Array }).bytes : null;
}

interface Player {
  session: PlayerSession;
  loader: AssetLoader;
  cache: AssetCache;
}

/** A real GM session, broadcaster, registry and asset server, and players with loaders, over an in-memory network. */
function world(files: MemoryImageFiles, tokens = objects(TAVERN)) {
  const network = new MemoryNetwork();
  const host = network.host('gm');
  const gmEnds: MemoryLink[] = [];
  host.onConnection((link) => gmEnds.push(link as MemoryLink));
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(host, {
    title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  const settings = { getLocalPlayerViewSettings: (): PlayerViewRules => RULES, onChange: (): (() => void) => () => {} };
  const notices: string[] = [];
  const registry = new AssetRegistry({ files: files.source, notify: (message) => notices.push(message), hash: nodeHash });
  const presented = presenter();
  const broadcaster = new SceneHub({ tabs: null, assignments: new SceneAssignments(), session: gm, presented, settings, assets: registry, notify: (message) => notices.push(message) });
  const server = new AssetServer({ session: gm, projection: broadcaster, files: registry });
  broadcaster.start();
  server.start();

  const { view, store, tavern } = sceneView(presented, sceneState('maps/tavern.png', tokens), { mapSize: { width: 2000, height: 1500 } });

  /** Every asset text message, either way, and every binary byte that reached a player. */
  const assetText: string[] = [];
  let binaryBytes = 0;
  const players: Player[] = [];
  const join = async (playerKey: string, device: ImageStore = new MemoryStore()): Promise<Player> => {
    const before = requests.length;
    const cache = new AssetCache({ keep: true, openStore: async () => device });
    const loader = new AssetLoader({ cache, decode, hash: nodeHash, onChange: () => {} });
    const inner = network.client();
    const transport: ClientTransport = {
      connect: async (hostId: string): Promise<PeerLink> => {
        const link = await inner.connect(hostId);
        const send = link.send.bind(link);
        link.send = (channel, data): void => {
          if (channel === 'assets' && typeof data === 'string') assetText.push(data);
          send(channel, data);
        };
        link.onMessage((channel, data) => {
          if (channel !== 'assets') return;
          if (typeof data === 'string') assetText.push(data);
          else binaryBytes += (data as ArrayBuffer).byteLength;
        });
        return link;
      },
    };
    const session = new PlayerSession({
      hostId: 'gm', name: playerKey, playerKey, clientVersion: '1', transport, onChange: () => {},
      assets: loader, onScene: (scene) => loader.setScene(scene),
    });
    session.start();
    await vi.advanceTimersByTimeAsync(0);
    if (requests.length > before) gm.allow(requests.at(-1)!.playerId);
    const player = { session, loader, cache };
    players.push(player);
    return player;
  };
  const messages = (): AssetMessage[] => assetText.flatMap((text) => {
    const decoded = decodeAsset(text);
    return decoded.kind === 'message' ? [decoded.message] : [];
  });
  return {
    presented, store, view, tavern, gmEnds, join, messages, assetText,
    binaryBytes: (): number => binaryBytes,
    requested: (): string[] => messages().flatMap((message) => (message.type === 'asset-request' ? message.ids : [])),
    started: (): string[] => messages().flatMap((message) => (message.type === 'asset-start' ? [message.id] : [])),
    /** Lets hashing, the 50 ms ticks, reads, transfers and decoding all happen. */
    run: async (): Promise<void> => { for (let round = 0; round < 4; round++) await vi.advanceTimersByTimeAsync(SCENE_TICK_MS + 5); },
    finish(): void {
      players.forEach((player) => player.session.stop());
      server.stop();
      broadcaster.stop();
      registry.dispose();
      gm.stop();
    },
  };
}

describe('asset streaming end to end', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('gives a player the GM\'s bytes, one transfer per image, and never a path', async () => {
    const files = memoryImageFiles({ 'maps/tavern.png': MAP, 'art/hero.png': HERO, 'art/goblin.png': GOBLIN });
    const w = world(files);
    const anna = await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await w.run();
    const scene = anna.session.scene!;
    expect(scene.map.asset).toBe(fingerprintOf(MAP));
    expect(scene.tokens.twin?.image).toBe(scene.tokens.hero?.image);
    expect(shown(anna.loader, scene.map.asset)).toEqual(MAP);
    expect(shown(anna.loader, scene.tokens.hero?.image)).toEqual(HERO);
    expect(w.started()).toEqual([fingerprintOf(MAP), fingerprintOf(HERO)]);
    expect(files.reads).not.toContain('art/goblin.png'); // under fog: never projected, never read
    expect(anna.loader.progress().outstanding).toBe(0);
    expect(w.assetText.join('\n')).not.toMatch(/art\/|maps\/|\.png/);
    w.finish();
  });

  it('lets a returning player with kept images request nothing', async () => {
    const w = world(memoryImageFiles({ 'maps/tavern.png': MAP, 'art/hero.png': HERO }));
    const device = new MemoryStore();
    const first = await w.join('anna', device);
    w.presented.present(w.view, w.tavern);
    await w.run();
    expect(first.cache.state.usedBytes).toBe(MAP.byteLength + HERO.byteLength);
    first.session.stop();

    const requestedBefore = w.requested().length;
    const again = await w.join('anna', device); // the same browser, a new visit
    await w.run();
    expect(w.requested()).toHaveLength(requestedBefore);
    expect(shown(again.loader, fingerprintOf(MAP))).toEqual(MAP);
    expect(shown(again.loader, fingerprintOf(HERO))).toEqual(HERO);
    w.finish();
  });

  it('recovers from a disconnect in the middle of a transfer, and scene updates keep flowing', async () => {
    const bigMap = imageBytes(3 * MB, 4);
    const w = world(memoryImageFiles({ 'maps/tavern.png': bigMap, 'art/hero.png': HERO }));
    const anna = await w.join('anna');
    const gmEnd = w.gmEnds.at(-1)!;
    gmEnd.hold('assets');
    w.presented.present(w.view, w.tavern);
    await w.run();
    expect(gmEnd.bufferedAmount('assets')).toBeGreaterThanOrEqual(ASSET_LIMITS.highWaterBytes);

    // Token moves are not held up behind the image.
    patchToken(w.store, 'hero', { x: 320 });
    await w.run();
    expect(anna.session.scene?.tokens.hero?.x).toBe(320);

    gmEnd.flush('assets', 512 * 1024); // part of the map arrives
    expect(anna.loader.progress().receivedBytes).toBeGreaterThan(0);
    expect(anna.loader.progress().totalBytes).toBe(3 * MB);

    (anna.session as unknown as { link: PeerLink }).link.close();
    expect(anna.loader.progress().receivedBytes).toBe(0);
    await vi.advanceTimersByTimeAsync(1000); // the player reconnects on its own
    await w.run();
    // Hashing, not `toEqual`: comparing 3 million elements one by one takes seconds.
    expect(fingerprintOf(shown(anna.loader, fingerprintOf(bigMap)) ?? new Uint8Array(0))).toBe(fingerprintOf(bigMap));
    expect(shown(anna.loader, fingerprintOf(HERO))).toEqual(HERO);
    expect(anna.loader.progress().outstanding).toBe(0);
    w.finish();
  });

  it('stops the transfer of an image that leaves the scene', async () => {
    const mapBytes = imageBytes(1000, 6);
    const dragon = imageBytes(3 * MB, 5);
    const w = world(
      memoryImageFiles({ 'maps/tavern.png': mapBytes, 'art/dragon.png': dragon }),
      objects({ dragon: { x: 140, y: 140, imagePath: 'art/dragon.png' } }),
    );
    const anna = await w.join('anna');
    const gmEnd = w.gmEnds.at(-1)!;
    gmEnd.hold('assets');
    w.presented.present(w.view, w.tavern);
    await w.run();
    gmEnd.flush('assets', 600 * 1024); // the small map and part of the dragon arrive
    await w.run();
    expect(shown(anna.loader, fingerprintOf(mapBytes))).toEqual(mapBytes);
    expect(anna.loader.progress().receivedBytes).toBeGreaterThan(0);

    w.store.setState((state) => ({ objects: { ...state.objects, tokens: {} } })); // the GM deletes the dragon
    await w.run();
    gmEnd.release('assets');
    await w.run();
    expect(w.binaryBytes()).toBeLessThan(1.5 * MB);
    const denied = w.messages().flatMap((message) => (message.type === 'asset-denied' ? [message.id] : []));
    expect(denied).toEqual([fingerprintOf(dragon)]);
    expect(anna.loader.progress()).toEqual({ outstanding: 0, receivedBytes: 0, totalBytes: 0 });
    expect(gmEnd.bufferedAmount('assets')).toBe(0);
    w.finish();
  });

  it('an image edited during the session reaches players as its new version', async () => {
    const files = memoryImageFiles({ 'maps/tavern.png': MAP, 'art/hero.png': HERO });
    const w = world(files);
    const anna = await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await w.run();
    const oldId = fingerprintOf(HERO);
    expect(shown(anna.loader, oldId)).toEqual(HERO);

    const edited = imageBytes(1000, 9);
    files.set('art/hero.png', edited, 2); // the GM repainted the hero
    const ben = await w.join('ben'); // asks for the image as it was: the GM finds it changed
    await w.run();
    const newId = fingerprintOf(edited);
    expect(anna.session.scene?.tokens.hero?.image).toBe(newId);
    expect(shown(anna.loader, newId)).toEqual(edited);
    expect(shown(ben.loader, newId)).toEqual(edited);
    expect(shown(anna.loader, oldId)).toBeNull();
    expect(w.messages()).toContainEqual({ v: 1, type: 'asset-denied', id: oldId });
    w.finish();
  });
});
