import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { AssetLoader, type ImageDecoder } from '../../../../src/app/online/assets/AssetLoader';
import { decodeAsset } from '../../../../src/app/online/assets/assetProtocol';
import { GmSession, type SessionPlayer } from '../../../../src/app/online/GmSession';
import { joinedSessionStore } from '../../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService, type OnlineSceneSink } from '../../../../src/app/online/obsidian/OnlineJoinService';
import { DEFAULT_ONLINE_SETTINGS } from '../../../../src/app/online/onlineSettings';
import { decodeControl, type ControlMessage } from '../../../../src/app/online/protocol';
import type { BoardCamera, BoardExtras } from '../../../../src/app/online/scene/boardTypes';
import { MemoryNetwork } from '../../../fake/MemoryTransport';
import type { ClientTransport } from '../../../../src/app/online/transport/types';
import { nodeHash } from '../assetFixtures';

const LINK = 'https://example.org/join/#id=gm';
const ID = { tex: 'T'.repeat(43), glb: 'G'.repeat(43), map: 'M'.repeat(43) };

const board = (walls: number, extra: Partial<BoardExtras> = {}): BoardExtras => ({
  sceneId: 's1',
  walls: Array.from({ length: walls }, (_, i) => ({ id: `w${i}`, type: 'solid' as const, p1: { x: i, y: 0 }, p2: { x: i + 1, y: 0 }, height: null, material: null })),
  lights: [], props: [], materials: [], ambient: null, fogHeight: null, wallThickness: null,
  lighting: { enabled: false, ambient: 1, ambientColor: null },
  ...extra,
});

function sink() {
  const offers: boolean[] = [];
  const boards: Array<BoardExtras | null> = [];
  const cameras: Array<BoardCamera | null> = [];
  const value: OnlineSceneSink = {
    session: () => {}, scene: () => {}, camera: () => {}, control: () => {}, moveRefused: () => {}, diceLog: () => {}, ownRoll: () => {},
    laser: () => {}, images: () => {}, close: () => {},
    boardOffer: (available) => offers.push(available),
    boardExtras: (extras) => boards.push(extras),
    boardCamera: (camera) => cameras.push(camera),
  };
  return { value, offers, boards, cameras };
}

function world() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), { title: 'Table', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {} });
  const fromPlayer: ControlMessage[] = [];
  gm.use({ onMessage: (_player, message) => { fromPlayer.push(message); } });
  gm.start();
  const settings = { get: () => ({ ...DEFAULT_ONLINE_SETTINGS, playerName: 'Anna' }), set: () => {}, onChange: () => () => {} };
  const inner = network.client();
  const transport: ClientTransport = { connect: (hostId) => inner.connect(hostId) };
  const decode: ImageDecoder = async () => ({ image: {} as HTMLImageElement, width: 1, height: 1, release: () => {} });
  const service = new OnlineJoinService({} as App, settings, '0.5.0', {
    createClient: () => transport, openStore: async () => null, decode, hash: nodeHash, openSceneTab: async () => undefined, isHosting: () => false,
  });
  const join = async () => {
    service.join(LINK, 'Anna');
    await vi.advanceTimersByTimeAsync(0);
    gm.allow(requests.at(-1)!.playerId);
    await vi.advanceTimersByTimeAsync(0);
    return requests.at(-1)!.playerId;
  };
  const send = async (playerId: string, message: ControlMessage) => {
    gm.send(playerId, message);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { gm, service, join, send, fromPlayer };
}

describe('the player side of the 3D board', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    joinedSessionStore.setState({ session: null });
    vi.useRealTimers();
  });

  it('the GM\'s offer reaches the tab, also one that attaches later', async () => {
    const w = world();
    const id = await w.join();
    await w.send(id, { v: 1, type: 'board-offer', available: true });
    const tab = sink();
    w.service.attach(tab.value);
    expect(tab.offers).toEqual([true]);
    expect(w.service.boardOffered()).toBe(true);
  });

  it('a board in parts reaches the tab once, whole; an older seq\'s late part is dropped', async () => {
    const w = world();
    const id = await w.join();
    const tab = sink();
    w.service.attach(tab.value);
    const whole = board(3);
    await w.send(id, { v: 1, type: 'board-extras', seq: 5, part: 1, parts: 2, extras: { ...whole, walls: whole.walls.slice(2) } });
    expect(tab.boards).toEqual([]);
    await w.send(id, { v: 1, type: 'board-extras', seq: 4, part: 0, parts: 2, extras: board(1) });
    await w.send(id, { v: 1, type: 'board-extras', seq: 5, part: 0, parts: 2, extras: { ...whole, walls: whole.walls.slice(0, 2) } });
    expect(tab.boards).toHaveLength(1);
    expect(tab.boards[0]!.walls.map((wall) => wall.id)).toEqual(['w0', 'w1', 'w2']);
    await w.send(id, { v: 1, type: 'board-extras', seq: 6, part: 0, parts: 1, extras: null });
    expect(tab.boards.at(-1)).toBeNull();
    await w.send(id, { v: 1, type: 'board-camera', camera: { sceneId: 's1', eye: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } } });
    expect(tab.cameras).toEqual([{ sceneId: 's1', eye: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } }]);
  });

  it('asks the GM for the board once per admission, only when the GM offered it', async () => {
    const w = world();
    const id = await w.join();
    w.service.wantBoard(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.fromPlayer.filter((m) => m.type === 'board-request')).toEqual([]);
    await w.send(id, { v: 1, type: 'board-offer', available: true });
    w.service.wantBoard(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.fromPlayer.filter((m) => m.type === 'board-request')).toEqual([{ v: 1, type: 'board-request', on: true }]);
    w.service.wantBoard(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.fromPlayer.filter((m) => m.type === 'board-request').at(-1)).toEqual({ v: 1, type: 'board-request', on: false });
  });
});

describe('AssetLoader and the board', () => {
  it('asks for the board\'s files besides the scene\'s, and lets them go when the board goes', async () => {
    vi.useRealTimers();
    const sent: string[][] = [];
    const cancelled: string[][] = [];
    const loader = new AssetLoader({ cache: { get: async () => null, put: async () => {} }, decode: async () => null, hash: nodeHash, models: () => true, onChange: () => {} });
    loader.connected((data) => {
      const decoded = decodeAsset(data);
      if (decoded.kind !== 'message') return;
      if (decoded.message.type === 'asset-request') sent.push(decoded.message.ids);
      if (decoded.message.type === 'asset-cancel') cancelled.push(decoded.message.ids);
    });
    loader.setScene({ sceneId: 's1', map: { asset: ID.map, width: 1, height: 1, cellSize: 70 }, tokens: {} } as never);
    loader.setBoard(board(0, { materials: [{ id: ID.tex, scale: 1, maps: { color: ID.tex } }], props: [{ id: 'p', asset: ID.glb, x: 0, y: 0, scale: 1, turn: 0 }] }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent.flat().sort()).toEqual([ID.glb, ID.map, ID.tex].sort());
    loader.setBoard(null);
    expect(cancelled.flat().sort()).toEqual([ID.glb, ID.tex].sort());
    loader.dispose();
  });
});

void decodeControl;
