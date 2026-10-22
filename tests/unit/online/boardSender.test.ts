import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { decodeControl, encodeControl, MAX_CONTROL_MESSAGE_BYTES, type ControlMessage } from '../../../src/app/online/protocol';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { AssetServer } from '../../../src/app/online/assets/AssetServer';
import { boardAssetIds } from '../../../src/app/online/assets/assetIds';
import { BOARD_CAMERA_INTERVAL_MS, BoardSender, boardParts } from '../../../src/app/online/scene/BoardSender';
import { SceneHub } from '../../../src/app/online/scene/SceneHub';
import type { BoardSource, BoardPose } from '../../../src/app/online/scene/sceneSources';
import type { BoardLook } from '../../../src/app/online/scene/sceneContracts';
import { SceneAssignments } from '../../../src/app/online/split/SceneAssignments';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { memoryImageFiles, nodeHash } from './assetFixtures';
import { emptySceneState, TAVERN_MAP, viewWithViewport, FakeViewport } from './presentedFixtures';
import { pathPresenter, pathTabs } from './hubPath';
import type { OfferedDiceRules } from '../../../src/app/online/tools/toolMessages';

const LOOK: BoardLook = {
  wallHeight: () => null, wallMaterial: () => null, doorProp: () => null, lightHeight: () => null,
  fogHeight: 1, wallThickness: null, ambient: null, props: [], materials: [],
};

function fakeBoard(available = true) {
  const looks = new Set<() => void>();
  const cameras = new Set<() => void>();
  let pose: BoardPose | null = { eye: { x: 0, y: 500, z: 0 }, target: { x: 100, y: 0, z: 100 } };
  let on = available;
  const source: BoardSource = {
    available: () => on,
    lookFor: (mapPath) => (on && mapPath === TAVERN_MAP ? LOOK : null),
    camera: (mapPath) => (on && mapPath === TAVERN_MAP ? pose : null),
    subscribe: (listener) => { looks.add(listener); return () => { looks.delete(listener); }; },
    subscribeCamera: (listener) => { cameras.add(listener); return () => { cameras.delete(listener); }; },
  };
  return {
    source,
    setAvailable: (next: boolean) => { on = next; for (const listener of [...looks]) listener(); },
    move: (next: BoardPose) => { pose = next; for (const listener of [...cameras]) listener(); },
  };
}

const wall = (id: string, closed: boolean) => ({ id, type: 'door', p1: { x: 100, y: 100 }, p2: { x: 170, y: 100 }, closed });

function world(board: ReturnType<typeof fakeBoard> | null, diceRules?: (mapPath: string | null) => OfferedDiceRules) {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), { title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {} });
  gm.start();
  const rules: PlayerViewRules = { showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true };
  const settings = { getLocalPlayerViewSettings: (): PlayerViewRules => rules, onChange: (): (() => void) => () => {} };
  const presented = pathPresenter();
  const tabs = pathTabs(presented);
  const assets = new AssetRegistry({ files: memoryImageFiles().source, notify: () => {}, hash: nodeHash });
  const hub = new SceneHub({ tabs, assignments: new SceneAssignments(), session: gm, presented, settings, assets, notify: () => {}, ...(board ? { board: board.source } : {}) });
  const sender = new BoardSender({ session: gm, projection: hub, board: board?.source ?? null, ...(diceRules ? { diceRules } : {}) });
  hub.start();
  sender.start();
  const state = emptySceneState();
  (state.objects as unknown as { walls: unknown }).walls = { d1: wall('d1', true) };
  const scene = viewWithViewport(presented, new FakeViewport(), state);
  const received = new Map<string, ControlMessage[]>();
  const players = new Map<string, PlayerSession>();
  const join = async (key: string): Promise<PlayerSession> => {
    const before = requests.length;
    const inner = network.client();
    const log: ControlMessage[] = [];
    received.set(key, log);
    const transport: ClientTransport = {
      connect: async (hostId: string): Promise<PeerLink> => {
        const link = await inner.connect(hostId);
        link.onMessage((channel, data) => {
          const decoded = channel === 'control' ? decodeControl(data) : null;
          if (decoded?.kind === 'message') log.push(decoded.message);
        });
        // The player's own sends, through the same link.
        players.set(key, Object.assign(players.get(key) ?? {}, { link }) as never);
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
  const ask = async (key: string, on: boolean) => {
    const link = (players.get(key) as unknown as { link: PeerLink }).link;
    link.send('control', encodeControl({ v: 1, type: 'board-request', on }));
    await vi.advanceTimersByTimeAsync(0);
  };
  const of = (key: string, type: ControlMessage['type']) => (received.get(key) ?? []).filter((message) => message.type === type);
  const setWalls = (walls: Record<string, unknown>) => {
    scene.store.setState({ objects: { ...scene.store.getState().objects, walls } } as never);
  };
  return { gm, presented, ...scene, join, ask, of, setWalls };
}

describe('BoardSender', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('tells each admitted player whether the board can be sent: no without Tabletop, yes with it, again when that changes', async () => {
    const none = world(null);
    await none.join('anna');
    expect(none.of('anna', 'board-offer')).toEqual([{ v: 1, type: 'board-offer', available: false }]);
    const board = fakeBoard();
    const w = world(board);
    await w.join('ben');
    expect(w.of('ben', 'board-offer')).toEqual([{ v: 1, type: 'board-offer', available: true }]);
    board.setAvailable(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.of('ben', 'board-offer').at(-1)).toMatchObject({ available: false });
  });

  it("offers dice results with the rules of the player's map when the GM takes them, and again when the board comes and goes", async () => {
    const savage: OfferedDiceRules = { defaultRoll: '1d6', crit: 'none', explode: { dice: 'all', repeats: true, highFaces: 1, lowFaces: 0 } };
    const diceRules = vi.fn((_mapPath: string | null) => savage);
    const board = fakeBoard();
    const w = world(board, diceRules);
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    await w.join('anna');
    expect(w.of('anna', 'board-offer')).toEqual([{ v: 1, type: 'board-offer', available: true, diceResults: true, diceRules: savage }]);
    expect(diceRules).toHaveBeenLastCalledWith(TAVERN_MAP);
    board.setAvailable(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.of('anna', 'board-offer').at(-1)).toEqual({ v: 1, type: 'board-offer', available: false, diceResults: true, diceRules: savage });
  });

  it('offers dice results without rules when they cannot be read, and keeps offering to later players', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = world(fakeBoard(), () => { throw new Error('no rules'); });
    await w.join('anna');
    await w.join('ben');
    expect(w.of('anna', 'board-offer')).toEqual([{ v: 1, type: 'board-offer', available: true, diceResults: true }]);
    expect(w.of('ben', 'board-offer')).toEqual([{ v: 1, type: 'board-offer', available: true, diceResults: true }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('offers rules it can vouch for only: rules that would not pass the check go as the defaults', async () => {
    const w = world(fakeBoard(), () => ({ defaultRoll: '', crit: 'natural' }));
    await w.join('anna');
    expect(w.of('anna', 'board-offer')).toEqual([{ v: 1, type: 'board-offer', available: true, diceResults: true, diceRules: { defaultRoll: '1d20', crit: 'natural' } }]);
  });

  it('only a player who asked gets the board extras of its scene, and stops getting them when it stops asking', async () => {
    const w = world(fakeBoard());
    await w.join('anna');
    await w.join('ben');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    await w.ask('anna', true);
    const extras = w.of('anna', 'board-extras');
    expect(extras).toHaveLength(1);
    expect(extras[0]).toMatchObject({ seq: expect.any(Number), part: 0, parts: 1, extras: { walls: [{ id: 'd1', type: 'door', door: { open: false } }] } });
    expect(w.of('ben', 'board-extras')).toEqual([]);
    await w.ask('anna', false);
    w.setWalls({ d1: wall('d1', false) });
    await vi.advanceTimersByTimeAsync(200);
    expect(w.of('anna', 'board-extras')).toHaveLength(1);
  });

  it('a door opening sends new extras once; a change players cannot see on the board sends none', async () => {
    const w = world(fakeBoard());
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    await w.ask('anna', true);
    w.setWalls({ d1: wall('d1', false) });
    await vi.advanceTimersByTimeAsync(200);
    const sent = w.of('anna', 'board-extras');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ extras: { walls: [{ id: 'd1', door: { open: true } }] } });
    w.setWalls({ d1: wall('d1', false) });
    await vi.advanceTimersByTimeAsync(200);
    expect(w.of('anna', 'board-extras')).toHaveLength(2);
  });

  it('the GM\'s 3D camera goes to players who asked, at most every 100 ms, the last move kept', async () => {
    const board = fakeBoard();
    const w = world(board);
    await w.join('anna');
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    await w.ask('anna', true);
    expect(w.of('anna', 'board-camera')).toHaveLength(1);
    for (let step = 1; step <= 10; step++) {
      board.move({ eye: { x: step, y: 500, z: 0 }, target: { x: 100, y: 0, z: 100 } });
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(BOARD_CAMERA_INTERVAL_MS);
    const moves = w.of('anna', 'board-camera').slice(1);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(moves.length).toBeLessThanOrEqual(3);
    expect(moves.at(-1)).toMatchObject({ camera: { eye: { x: 10 } } });
  });

  it('a board too big for one message goes in parts of one seq', async () => {
    const w = world(fakeBoard());
    await w.join('anna');
    const many = Object.fromEntries(Array.from({ length: 1600 }, (_, i) => [`w${i}`, { id: `w${i}`, type: 'solid', p1: { x: i, y: 10 }, p2: { x: i + 1, y: 10 } }]));
    w.setWalls(many);
    w.presented.present(w.view, w.tavern);
    await vi.advanceTimersByTimeAsync(0);
    await w.ask('anna', true);
    const parts = w.of('anna', 'board-extras') as Array<Extract<ControlMessage, { type: 'board-extras' }>>;
    expect(parts.map((part) => [part.part, part.parts])).toEqual([[0, 2], [1, 2]]);
    expect(new Set(parts.map((part) => part.seq)).size).toBe(1);
    expect(parts.reduce((sum, part) => sum + (part.extras?.walls.length ?? 0), 0)).toBe(1600);
  });
});

/** Well-formed fingerprints (43 base64url characters, as SHA-256 gives). */
const ID = { glb1: 'A'.repeat(43), glb2: 'B'.repeat(43), tex1: 'C'.repeat(43), tex2: 'D'.repeat(43) };

describe('board assets', () => {
  it('a board\'s files are its materials\' maps, door props and props, each once', () => {
    const ids = boardAssetIds({
      sceneId: 's', lights: [], ambient: null, fogHeight: null, wallThickness: null, lighting: { enabled: false, ambient: 1, ambientColor: null },
      walls: [{ id: 'd', type: 'door', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, height: null, material: 'm1', door: { open: false, swing: 'left', prop: ID.glb1 } }],
      props: [{ id: 'p', asset: ID.glb2, x: 0, y: 0, scale: 1, turn: 0 }, { id: 'q', asset: ID.glb1, x: 0, y: 0, scale: 1, turn: 0 }],
      materials: [{ id: 'm1', scale: 1, maps: { color: ID.tex1, normal: ID.tex2 } }],
    });
    expect(ids.sort()).toEqual([ID.glb1, ID.glb2, ID.tex1, ID.tex2].sort());
    expect(boardAssetIds(null)).toEqual([]);
  });

  it('a player may fetch the files of its scene\'s board, as of its scene\'s images', () => {
    const scene = { sceneId: 's', map: { asset: null }, tokens: {} } as never;
    const board = { sceneId: 's', walls: [], lights: [], props: [{ id: 'p', asset: ID.glb2, x: 0, y: 0, scale: 1, turn: 0 }], materials: [], ambient: null, fogHeight: null, wallThickness: null, lighting: { enabled: false, ambient: 1, ambientColor: null } };
    let slot: Record<string, unknown> = { tab: { viewId: 'v', tabId: 't' }, sceneId: 's', state: 'live', lastSent: scene, board: null, mapPath: '', name: '' };
    const server = new AssetServer({
      session: { use: () => () => undefined, assetChannel: () => null } as never,
      projection: { slotOf: () => slot as never, onSlotChange: () => () => undefined },
      files: { read: async () => null },
    });
    expect(server.allowedFor('anna').has(ID.glb2)).toBe(false);
    slot = { ...slot, board };
    expect(server.allowedFor('anna').has(ID.glb2)).toBe(true);
  });
});

describe('board parts by size', () => {
  it('a large painted board goes in parts that each fit one message, and come back whole', () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({
      id: `wall-${i.toString(36)}-${'x'.repeat(30)}`, type: 'solid' as const,
      p1: { x: 1234.5678901234 + i, y: 987.6543210987 }, p2: { x: 1304.5678901234 + i, y: 987.6543210987 }, height: 2.5, material: 'M'.repeat(43),
    }));
    const lights = Array.from({ length: 800 }, (_, i) => ({ id: `light-${i}-${'y'.repeat(30)}`, x: 1234.5678901234, y: 987.6543210987, height: 1.5, color: '#ffaa00', bright: 20, dim: 40, intensity: 1, animation: 'torch', angle: null, rotation: 0, darkness: false, activeBelowAmbient: null }));
    const extras = { sceneId: 's1', walls: many, lights, props: [], materials: [], ambient: null, fogHeight: null, wallThickness: null, lighting: { enabled: true, ambient: 0.2, ambientColor: null } };
    const parts = boardParts(extras);
    for (const [index, part] of parts.entries()) {
      const text = encodeControl({ v: 1, type: 'board-extras', seq: 1, part: index, parts: parts.length, extras: part });
      expect(new TextEncoder().encode(text).length).toBeLessThan(MAX_CONTROL_MESSAGE_BYTES);
      expect(decodeControl(text).kind).toBe('message');
    }
    expect(parts.reduce((sum, part) => sum + part.walls.length, 0)).toBe(3000);
    expect(parts.reduce((sum, part) => sum + part.lights.length, 0)).toBe(800);
  });
});
