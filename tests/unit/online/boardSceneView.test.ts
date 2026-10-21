import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { CanvasSceneView } from '../../../src/app/online/obsidian/CanvasSceneView';
import { joinedSessionStore } from '../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService, type OnlineSceneSink } from '../../../src/app/online/obsidian/OnlineJoinService';
import { ONLINE_SCENE_VIEW_TYPE } from '../../../src/app/online/obsidian/onlineSceneTab';
import type { PlayerBoardFactory, PlayerBoardHandle, PlayerBoardHost } from '../../../src/app/online/obsidian/playerBoardContract';
import type { PlayerSessionState } from '../../../src/app/online/PlayerSession';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import { memorySettings } from '../connect/memorySettings';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { playerScene, playerToken } from './sceneFixtures';

const admitted: PlayerSessionState = { status: 'admitted', playerId: 'me', title: 'Vault', players: [{ playerId: 'me', name: 'Anna', connected: true }], reason: null };
const roll: DiceLogEntry = { id: 'r1', name: 'Anna', formula: 'd20', dice: [{ die: 'd20', value: 11 }], modifier: 0, total: 11, at: 1, mine: true };

beforeEach(() => {
  Object.defineProperties(HTMLCanvasElement.prototype, {
    clientWidth: { configurable: true, get: () => 800 },
    clientHeight: { configurable: true, get: () => 600 },
  });
});
afterEach(() => {
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).clientHeight;
  joinedSessionStore.setState({ session: null });
  vi.restoreAllMocks();
});

/** A board factory that records what the tab asks of the handle and keeps the host it was given. */
function fakeFactory() {
  const calls: string[] = [];
  let host: PlayerBoardHost | null = null;
  let disposed = 0;
  const handle = new Proxy({} as PlayerBoardHandle, {
    get: (_target, name: string) => {
      if (name === 'toolState') return () => ({ tool: 'move', shape: 'line', templateShape: 'circle', ownTemplates: false, laserColor: '#fff', gmView: true });
      if (name === 'dispose') return () => { disposed++; calls.push('dispose'); };
      if (name === 'setExtras') return (extras: unknown) => { calls.push(`setExtras:${extras === null ? 'null' : 'data'}`); };
      return (...args: unknown[]) => { calls.push(`${name}${args.length && typeof args[0] === 'string' ? `:${args[0]}` : ''}`); };
    },
  });
  const factory: PlayerBoardFactory = {
    version: 1,
    create: (parent, given) => { host = given; calls.push(`create:${parent.className}`); return handle; },
  };
  return { factory, calls, host: () => host!, disposed: () => disposed };
}

function world() {
  const ws = {
    leaves: [] as unknown[], getActiveViewOfType: (): unknown => null, revealLeaf: vi.fn(),
    getLeavesOfType: (type: string): unknown[] => (type === ONLINE_SCENE_VIEW_TYPE ? ws.leaves : []),
    onLayoutReady: (callback: () => void): void => callback(),
  };
  const app = { workspace: ws } as unknown as App;
  const service = new OnlineJoinService(app, memorySettings(), '0.1.0', { openStore: async () => null, isHosting: () => false });
  const sinks: OnlineSceneSink[] = [];
  vi.spyOn(service, 'attach').mockImplementation((sink) => { sinks.push(sink); return () => undefined; });
  const wanted: boolean[] = [];
  vi.spyOn(service, 'wantBoard').mockImplementation((on) => { wanted.push(on); });
  const board = fakeFactory();
  let painter: PlayerBoardFactory | null = board.factory;
  vi.spyOn(service, 'boardPainter').mockImplementation(() => painter);
  const moves: Array<[string, number, number]> = [];
  vi.spyOn(service, 'sendTokenMove').mockImplementation((id, x, y) => { moves.push([id, x, y]); return true; });
  const notes: string[] = [];
  vi.spyOn(service, 'sendNoteRequest').mockImplementation((pinId) => { notes.push(pinId); return true; });
  const surface = new RecordingSurface();
  const open = async () => {
    const leaf = { app, view: null as unknown, detach: vi.fn() };
    const view = new CanvasSceneView(leaf as unknown as WorkspaceLeaf, { surface, frames: fakeFrames(), isHidden: () => false });
    leaf.view = view;
    ws.leaves.push(leaf);
    await view.onOpen();
    return { view, sink: sinks.at(-1)! };
  };
  return { service, open, board, wanted, moves, notes, setPainter: (next: PlayerBoardFactory | null) => { painter = next; } };
}

describe('the 3D board in the player tab', () => {
  it('with Tabletop and the GM\'s offer the tab shows the board and asks the GM for it', async () => {
    const w = world();
    const { sink } = await w.open();
    sink.session(admitted);
    expect(w.board.calls).toEqual([]);
    sink.boardOffer?.(true);
    expect(w.board.calls[0]).toBe('create:atlas-connect-scene__board');
    expect(w.wanted.at(-1)).toBe(true);
    sink.scene(playerScene());
    expect(w.board.calls).toContain('setScene');
    sink.boardExtras?.(null);
    expect(w.board.calls).toContain('setExtras:null');
  });

  it('without the GM\'s offer, or without Tabletop, the tab stays 2D', async () => {
    const w = world();
    const { sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(false);
    expect(w.board.calls).toEqual([]);
    w.setPainter(null);
    sink.boardOffer?.(true);
    expect(w.board.calls).toEqual([]);
  });

  it('Tabletop leaving swaps back to 2D, stops asking for the board and keeps the dice log', async () => {
    const w = world();
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.diceLog([roll]);
    sink.boardOffer?.(true);
    expect(w.board.calls[0]).toMatch(/^create/);
    w.setPainter(null);
    sink.images();
    expect(w.board.disposed()).toBe(1);
    expect(w.wanted.at(-1)).toBe(false);
    expect(view.contentEl.querySelector<HTMLElement>('.atlas-connect-scene__board')?.hidden).toBe(true);
    expect(view.contentEl.querySelector('.dice-log-list')?.children.length).toBe(1);
  });

  it('the 2D/3D button goes back to 2D and to 3D again', async () => {
    const w = world();
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true);
    const toggle = view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Show 2D map"]');
    expect(toggle).not.toBeNull();
    toggle!.click();
    expect(w.board.disposed()).toBe(1);
    expect(view.contentEl.querySelector('[aria-label="Show 3D board"]')).not.toBeNull();
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Show 3D board"]')!.click();
    expect(w.board.calls.filter((call) => call.startsWith('create'))).toHaveLength(2);
  });

  it('the toolbar\'s tools reach the board, and the board\'s moves, pins and hovers reach the session and panels', async () => {
    const w = world();
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true);
    sink.scene(playerScene({ tokens: { t1: playerToken({ name: 'Orc', conditions: [{ id: 'f', value: 2, name: 'Frightened', color: '#e93147', icon: 'terror' }] as never }) } }));
    // Laser is in the Move group's menu, as in Atlas.
    [...view.contentEl.querySelectorAll<HTMLButtonElement>('[data-control="move"] .menu-entry')].find((entry) => entry.textContent === 'Laser')!.click();
    expect(w.board.calls.some((call) => call.startsWith('selectTool'))).toBe(true);
    const host = w.board.host();
    expect(host.sendMove('t1', 10, 20)).toBe(true);
    expect(w.moves).toEqual([['t1', 10, 20]]);
    host.openPin('pin-1');
    expect(w.notes).toEqual(['pin-1']);
    host.hover('t1', { x: 50, y: 60 }, false);
    expect(view.contentEl.textContent).toContain('Frightened');
  });

  it('in 3D the GM view and Fit map buttons show and reach the board', async () => {
    const w = world();
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true);
    sink.scene(playerScene());
    const buttons = view.contentEl.querySelector<HTMLElement>('.view-buttons')!;
    expect(buttons.hidden).toBe(false);
    buttons.querySelector<HTMLButtonElement>('[aria-label="Fit map"]')!.click();
    buttons.querySelector<HTMLButtonElement>('[aria-label="Follow GM"]')!.click();
    expect(w.board.calls).toContain('fitMap');
    expect(w.board.calls.filter((call) => call === 'followGm')).toHaveLength(1);
  });

  it('a board switched off and on again starts without the old scene walls', async () => {
    const w = world();
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true);
    sink.boardExtras?.({ sceneId: 's1' } as never);
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Show 2D map"]')!.click();
    w.board.calls.length = 0;
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Show 3D board"]')!.click();
    expect(w.board.calls.filter((call) => call.startsWith('setExtras'))).toEqual(['setExtras:null']);
  });
});
