import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { CanvasSceneView } from '../../../src/app/online/obsidian/CanvasSceneView';
import { joinedSessionStore } from '../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService, type OnlineSceneSink } from '../../../src/app/online/obsidian/OnlineJoinService';
import { ONLINE_SCENE_VIEW_TYPE } from '../../../src/app/online/obsidian/onlineSceneTab';
import type { PlayerBoardFactory, PlayerBoardHandle, PlayerBoardHost, PlayerDiceRequest } from '../../../src/app/online/obsidian/playerBoardContract';
import { sheetThrow } from '../../../src/app/online/obsidian/onlineDice';
import type { TokenSheet } from '../../../src/app/online/tools/sheets';
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

/**
 * A board factory that records what the tab asks of the handle and keeps the host it was given; with `dice`, the board
 * throws dice (`throwDice` answering `dice.throws`) and records each throw.
 */
function fakeFactory(dice?: { throws: boolean }) {
  const calls: string[] = [];
  const throws: PlayerDiceRequest[] = [];
  let host: PlayerBoardHost | null = null;
  let disposed = 0;
  const handle = new Proxy({} as PlayerBoardHandle, {
    get: (_target, name: string) => {
      if (name === 'diceAvailable') return dice ? true : undefined;
      if (name === 'throwDice') return dice ? (request: PlayerDiceRequest) => { throws.push(request); return dice.throws; } : undefined;
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
  return { factory, calls, throws, host: () => host!, disposed: () => disposed };
}

function world(dice?: { throws: boolean }) {
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
  const board = fakeFactory(dice);
  let painter: PlayerBoardFactory | null = board.factory;
  vi.spyOn(service, 'boardPainter').mockImplementation(() => painter);
  const moves: Array<[string, number, number]> = [];
  vi.spyOn(service, 'sendTokenMove').mockImplementation((id, x, y) => { moves.push([id, x, y]); return true; });
  const notes: string[] = [];
  vi.spyOn(service, 'sendNoteRequest').mockImplementation((pinId) => { notes.push(pinId); return true; });
  const rolls: Array<[unknown, number]> = [];
  vi.spyOn(service, 'sendDiceRoll').mockImplementation((picked, modifier) => { rolls.push([picked, modifier]); return true; });
  const results: unknown[] = [];
  vi.spyOn(service, 'sendDiceResult').mockImplementation((result) => { results.push(result); return true; });
  const sheetRolls: unknown[] = [];
  vi.spyOn(service, 'sendSheetRoll').mockImplementation((tokenId, ref) => { sheetRolls.push([tokenId, ref]); return true; });
  const surface = new RecordingSurface();
  let now = 1000;
  const open = async () => {
    const leaf = { app, view: null as unknown, detach: vi.fn() };
    const view = new CanvasSceneView(leaf as unknown as WorkspaceLeaf, { surface, frames: fakeFrames(), isHidden: () => false, now: () => now });
    leaf.view = view;
    ws.leaves.push(leaf);
    await view.onOpen();
    return { view, sink: sinks.at(-1)! };
  };
  return {
    service, open, board, wanted, moves, notes, rolls, results, sheetRolls, tick: (ms: number) => { now += ms; },
    setPainter: (next: PlayerBoardFactory | null) => { painter = next; } };
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
    view.contentEl.querySelector<HTMLButtonElement>('[data-control="move"] .menu-entry[data-tool="laser"]')!.click();
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

/** Picks a d20 and a modifier of +2 in the tray, then presses Roll. */
function rollD20Plus2(root: HTMLElement): void {
  if (root.querySelector<HTMLElement>('.dice-tray')?.hidden) root.querySelector<HTMLButtonElement>('.toolbar button[aria-label="Dice"]')!.click();
  root.querySelector<HTMLButtonElement>('.tray-face[data-die="d20"]')!.click();
  root.querySelector<HTMLButtonElement>('[aria-label="Increase modifier"]')!.click();
  root.querySelector<HTMLButtonElement>('[aria-label="Increase modifier"]')!.click();
  root.querySelector<HTMLButtonElement>('.tray-roll')!.click();
}

const sheetOf = (stats: number[]): TokenSheet => ({
  tokenId: 't1', name: 'Anna', resources: [],
  sheet: { name: 'Anna', subtitle: null, ac: null, hp: null, speed: null, stats, saves: [], skills: [], lines: [], sections: [] },
});

describe("the player's dice on the 3D board", () => {
  it('3D tray roll throws on the board', async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: null });
    sink.scene(playerScene());
    rollD20Plus2(view.contentEl);
    expect(w.board.throws).toEqual([{ dice: { d20: 1 }, modifier: 2 }]);
    expect(w.rolls).toEqual([]);
    // The board hands the landed dice back: they go to the GM as one dice-result.
    expect(w.board.host().sendDiceResult?.({ rolls: [{ die: 'd20', value: 7 }], modifier: 2 })).toBe(true);
    expect(w.results).toEqual([{ rolls: [{ die: 'd20', value: 7 }], modifier: 2 }]);
  });

  it("the board reads the rules of the player's map from the GM's offer", async () => {
    const w = world({ throws: true });
    const { sink } = await w.open();
    sink.session(admitted);
    const rules = { defaultRoll: '2d6', crit: 'doubles' as const };
    sink.boardOffer?.(true, { rules });
    expect(w.board.host().diceRules?.()).toEqual(rules);
  });

  it('old GM gets dice-roll', async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true);
    sink.scene(playerScene());
    rollD20Plus2(view.contentEl);
    expect(w.board.throws).toEqual([]);
    expect(w.rolls).toEqual([[{ d20: 1 }, 2]]);
  });

  it('2D view keeps dice-roll', async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: null });
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Show 2D map"]')!.click();
    rollD20Plus2(view.contentEl);
    expect(w.board.throws).toEqual([]);
    expect(w.rolls).toEqual([[{ d20: 1 }, 2]]);
  });

  it('a board without dice, or one that cannot throw now, leaves the roll to the GM', async () => {
    const plain = world();
    const first = await plain.open();
    first.sink.session(admitted);
    first.sink.boardOffer?.(true, { rules: null });
    rollD20Plus2(first.view.contentEl);
    expect(plain.rolls).toEqual([[{ d20: 1 }, 2]]);
    const refusing = world({ throws: false });
    const second = await refusing.open();
    second.sink.session(admitted);
    second.sink.boardOffer?.(true, { rules: null });
    rollD20Plus2(second.view.contentEl);
    expect(refusing.board.throws).toHaveLength(1);
    expect(refusing.rolls).toEqual([[{ d20: 1 }, 2]]);
  });

  it('throws at most two rolls a second, refusing the next as the tray refuses a roll that did not go', async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: null });
    rollD20Plus2(view.contentEl);
    rollD20Plus2(view.contentEl);
    rollD20Plus2(view.contentEl);
    expect(w.board.throws).toHaveLength(2);
    expect(w.rolls).toEqual([]);
    expect(view.contentEl.querySelector('.dice-tray .dice-note')?.textContent).not.toBe('');
    w.tick(1000);
    view.contentEl.querySelector<HTMLButtonElement>('.tray-roll')!.click();
    expect(w.board.throws).toHaveLength(3);
  });

  it("sheet roll in 3D throws the sheet's dice", async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: null });
    sink.sheets?.([sheetOf([10, 14, 10, 10, 10, 10])]);
    // DEX 14: a bare +2, thrown with the rules' default roll (Atlas's 1d20 without rules).
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Roll DEX check"]')!.click();
    expect(w.board.throws).toEqual([{ dice: { d20: 1 }, modifier: 2, label: 'DEX check', sheet: { tokenId: 't1', roll: { kind: 'check', index: 1 } } }]);
    expect(w.sheetRolls).toEqual([]);
  });

  it("a sheet roll thrown by the map's rules, and one the board cannot throw left to the GM", async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: { defaultRoll: '2d6', crit: 'none' } });
    const entry = sheetOf([10, 8, 10, 10, 10, 10]);
    entry.sheet!.sections = [{ title: 'Actions', items: [{ name: 'Curse', desc: 'Hit: 2d6 - 1d4 necrotic.' }] }];
    sink.sheets?.([entry]);
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Roll DEX check"]')!.click();
    expect(w.board.throws.at(-1)).toMatchObject({ dice: { d6: 2 }, modifier: -1 });
    // A die that subtracts is no physical die: the GM rolls it.
    w.tick(1000);
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label^="Roll Curse"]')!.click();
    expect(w.board.throws).toHaveLength(1);
    expect(w.sheetRolls).toHaveLength(1);
  });

  it('own physical roll is logged but not re-thrown', async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: null });
    sink.scene(playerScene());
    rollD20Plus2(view.contentEl);
    const mine: DiceLogEntry = { ...roll, id: 'p1', formula: '1d20+2', dice: [{ die: 'd20', value: 7 }], modifier: 2, total: 9 };
    sink.diceLog([mine]);
    sink.ownRoll(mine);
    expect(view.contentEl.querySelector('.dice-log-list')?.children.length).toBe(1);
    expect(view.contentEl.querySelector('.dice-toasts')?.textContent).toContain('9');
    expect(w.board.throws).toHaveLength(1);
  });
});

describe("the player's dice while the session is not in, or the offer changed", () => {
  it('a roll pressed while not admitted is not thrown: the tray says it did not go, as today', async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: null });
    sink.scene(playerScene());
    vi.spyOn(w.service, 'sendDiceRoll').mockReturnValue(false);
    sink.session({ ...admitted, status: 'connecting' });
    rollD20Plus2(view.contentEl);
    expect(w.board.throws).toEqual([]);
    expect(view.contentEl.querySelector('.dice-tray .dice-note')?.textContent).toContain("Couldn't send the roll");
  });

  it('an offer without dice after one with dice goes back to dice-roll', async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: null });
    sink.boardOffer?.(true);
    rollD20Plus2(view.contentEl);
    expect(w.board.throws).toEqual([]);
    expect(w.rolls).toEqual([[{ d20: 1 }, 2]]);
  });

  it('a reconnect forgets the dice offer until the GM offers again', async () => {
    const w = world({ throws: true });
    const { view, sink } = await w.open();
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: null });
    sink.session({ ...admitted, status: 'connecting' });
    sink.session(admitted);
    rollD20Plus2(view.contentEl);
    expect(w.board.throws).toEqual([]);
    expect(w.rolls).toEqual([[{ d20: 1 }, 2]]);
    sink.boardOffer?.(true, { rules: null });
    w.tick(1000);
    rollD20Plus2(view.contentEl);
    expect(w.board.throws).toHaveLength(1);
  });
});

describe('a sheet roll as the board throws it', () => {
  const textSheet = (desc: string): TokenSheet => {
    const entry = sheetOf([10, 10, 10, 10, 10, 10]);
    entry.sheet!.sections = [{ title: 'Actions', items: [{ name: 'Volley', desc }] }];
    return entry;
  };
  const ref = (text: string, side?: 'advantage' | 'disadvantage') => ({ kind: 'text' as const, section: 0, item: 0, index: 0, text, ...(side ? { side } : {}) });

  it('throws up to 20 dice, and up to 19 with a side, so the extra die stays within 20', () => {
    expect(sheetThrow(textSheet('Hit: 20d6 fire.'), ref('20d6'), null)).toMatchObject({ dice: { d6: 20 }, modifier: 0 });
    expect(sheetThrow(textSheet('Hit: 20d6 fire.'), ref('20d6', 'advantage'), null)).toBeNull();
    expect(sheetThrow(textSheet('Hit: 19d6 fire.'), ref('19d6', 'disadvantage'), null)).toMatchObject({ dice: { d6: 19 }, advantage: 'disadvantage' });
  });
});
