/**
 * An Obsidian player against the real GM side over `MemoryTransport`: the join service and the Canvas 2D scene tab
 * (`CanvasSceneView`), with the GM's session, scene broadcaster, token control, dice host and laser relay
 * (`toolsWorld`); for physical dice also Tabletop's 3D board as the GM offers it (`BoardSender`), and a fake player
 * board that lands scripted values and hands them back as Tabletop's `RollSession.result()` does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import type { ImageDecoder } from '../../../../src/app/online/assets/AssetLoader';
import { CanvasSceneView } from '../../../../src/app/online/obsidian/CanvasSceneView';
import { joinedSessionStore } from '../../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService, type OnlineSceneSink } from '../../../../src/app/online/obsidian/OnlineJoinService';
import { ONLINE_SCENE_VIEW_TYPE } from '../../../../src/app/online/obsidian/onlineSceneTab';
import type { PlayerBoardFactory, PlayerBoardHandle, PlayerBoardHost, PlayerDiceRequest } from '../../../../src/app/online/obsidian/playerBoardContract';
import { offeredRulesOf } from '../../../../src/app/online/atlas/toolParts';
import { BoardSender } from '../../../../src/app/online/scene/BoardSender';
import type { BoardSource } from '../../../../src/app/online/scene/sceneSources';
import type { PlayerScene } from '../../../../src/app/online/scene/sceneTypes';
import type { DiceLogEntry, OfferedDiceRules, PhysicalDie, PlayerLaser } from '../../../../src/app/online/tools/toolMessages';
import { memorySettings } from '../../connect/memorySettings';
import { nodeHash } from '../assetFixtures';
import { TAVERN_MAP } from '../presentedFixtures';
import { fakeFrames, RecordingSurface } from '../recordingSurface';
import { toolsWorld } from '../toolsFixtures';

type FakeLeaf = { app: unknown; view: unknown; detach: ReturnType<typeof vi.fn> };

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

/** Tabletop on the GM's side, sharing its board; nothing of the board itself is needed here. */
const SHARED_BOARD: BoardSource = {
  available: () => true, lookFor: () => null, camera: () => null, subscribe: () => () => {}, subscribeCamera: () => () => {},
};

const SIDES: Record<PhysicalDie['die'], number> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 };

/**
 * Tabletop's player board, its dice only: a throw lands the next scripted values, one per die, half a second later. A
 * die that explodes by the rules the GM offered (`host.diceRules()`) asks for another die of its kind, which lands the
 * next value and is marked `exploded`. The finished roll goes back through `host.sendDiceResult` in the shape
 * Tabletop's `RollSession.result()` gives and its `PlayerDice` sends: each die with its `max`, the modifier, no total.
 */
function fakeDiceBoard(landing: number[]) {
  const throws: PlayerDiceRequest[] = [];
  const sent: boolean[] = [];
  let host: PlayerBoardHost | null = null;
  const settle = (request: PlayerDiceRequest): void => {
    const rule = host!.diceRules?.()?.explode;
    const rolls: Array<PhysicalDie & { max: number }> = [];
    for (const [die, count] of Object.entries(request.dice) as Array<[PhysicalDie['die'], number]>) {
      for (let i = 0; i < count; i++) {
        for (let exploded = false; ; exploded = true) {
          const value = landing.shift()!;
          rolls.push({ die, value, max: SIDES[die], ...(exploded ? { exploded: true as const } : {}) });
          if (!rule || value <= SIDES[die] - rule.highFaces || (exploded && !rule.repeats)) break;
        }
      }
    }
    sent.push(host!.sendDiceResult!({ rolls, modifier: request.modifier }));
  };
  const handle = new Proxy({} as PlayerBoardHandle, {
    get: (_target, name: string) => {
      if (name === 'diceAvailable') return host?.sendDiceResult ? true : undefined;
      if (name === 'throwDice') {
        return (request: PlayerDiceRequest): boolean => {
          throws.push(request);
          setTimeout(() => settle(request), 500);
          return true;
        };
      }
      if (name === 'toolState') return () => ({ tool: 'move', shape: 'line', templateShape: 'circle', ownTemplates: false, laserColor: '#fff', gmView: false });
      return () => undefined;
    },
  });
  const factory: PlayerBoardFactory = { version: 1, create: (_parent, given) => { host = given; return handle; } };
  return { factory, throws, sent };
}

interface JoinOptions {
  /** Tabletop on both sides: the GM shares its board, the player shows this one. */
  board?: PlayerBoardFactory;
  /** The dice rules of the collection holding the tavern; with them the GM takes players' physical rolls, without them it is an older GM. */
  diceRules?: OfferedDiceRules;
}

/** The GM presents the tavern; Anna joins from Obsidian, is let in, and her scene tab opens and attaches. */
async function joinFromObsidian(options: JoinOptions = {}) {
  const w = toolsWorld();
  w.present();
  if (options.diceRules) w.atlas.rules.saveCollection('c1', { maps: [TAVERN_MAP], dice: options.diceRules });
  const boardSender = options.board ? new BoardSender({
    session: w.gm, projection: w.broadcaster, board: SHARED_BOARD, ...(options.diceRules ? { diceRules: offeredRulesOf(w.extension) } : {}),
  }) : null;
  boardSender?.start();
  const leaves: FakeLeaf[] = [];
  const vault = { create: vi.fn(), modify: vi.fn(), process: vi.fn(), read: vi.fn(), delete: vi.fn(), adapter: { write: vi.fn(), read: vi.fn() } };
  const workspace = {
    onLayoutReady: (callback: () => void): void => callback(),
    getLeavesOfType: (type: string): FakeLeaf[] => (type === ONLINE_SCENE_VIEW_TYPE ? leaves : []),
    revealLeaf: vi.fn(),
  };
  const app = { workspace, vault } as unknown as App;
  const surface = new RecordingSurface();
  const frames = fakeFrames();
  const seen = { scenes: [] as Array<PlayerScene | null>, lasers: [] as PlayerLaser[], logs: [] as Array<readonly DiceLogEntry[]> };
  const decode: ImageDecoder = async () => null;
  const opened: { view: CanvasSceneView | null; leaf: FakeLeaf | null } = { view: null, leaf: null };
  const service: OnlineJoinService = new OnlineJoinService(app, memorySettings(), '0.1.0', {
    createClient: () => w.network.client(), openStore: async () => null, decode, hash: nodeHash, isHosting: () => false,
    ...(options.board ? { minis: { current: () => null, subscribe: () => () => {}, board: () => options.board! } } : {}),
    openSceneTab: async () => {
      const leaf: FakeLeaf = { app, view: null, detach: vi.fn() };
      const view = new CanvasSceneView(leaf as unknown as WorkspaceLeaf, { surface, frames, isHidden: () => false });
      leaf.view = view;
      leaves.push(leaf);
      opened.view = view;
      opened.leaf = leaf;
      await view.onOpen();
    },
  });
  // The tab's sink, watched on its way: what the GM's scene and lasers looked like when they reached the tab.
  const attach = service.attach.bind(service);
  vi.spyOn(service, 'attach').mockImplementation((sink: OnlineSceneSink) => attach({
    session: (state) => sink.session(state),
    scene: (scene) => { seen.scenes.push(scene); sink.scene(scene); },
    camera: (camera) => sink.camera(camera),
    control: (tokenIds) => sink.control(tokenIds),
    moveRefused: (tokenId) => sink.moveRefused(tokenId),
    diceLog: (entries) => { seen.logs.push(entries); sink.diceLog(entries); },
    ownRoll: (entry) => sink.ownRoll(entry),
    laser: (laser) => { seen.lasers.push(laser); sink.laser(laser); },
    boardOffer: (available, dice) => sink.boardOffer?.(available, dice),
    boardExtras: (extras) => sink.boardExtras?.(extras),
    boardCamera: (camera) => sink.boardCamera?.(camera),
    images: () => sink.images(),
    close: () => sink.close(),
  }));
  expect(service.join('https://example.org/join/#id=gm', 'Anna')).toBeNull();
  await vi.advanceTimersByTimeAsync(0);
  const pending = w.gm.getPlayers().find((player) => player.status === 'pending');
  expect(pending).toMatchObject({ name: 'Anna', client: 'obsidian' });
  w.gm.allow(pending!.playerId);
  await vi.advanceTimersByTimeAsync(0);
  await w.tick();
  const view = (): CanvasSceneView => {
    if (!opened.view) throw new Error('The scene tab did not open');
    return opened.view;
  };
  /** Screen position of a world point, from the camera the tab last drew with. */
  const screenOf = (x: number, y: number): { x: number; y: number } => {
    frames.run();
    const camera = surface.calls.filter((call) => call.op === 'camera').at(-1);
    if (camera?.op !== 'camera') throw new Error('The tab drew nothing');
    return { x: x * camera.scale + camera.offsetX, y: y * camera.scale + camera.offsetY };
  };
  const finish = (): void => {
    service.dispose();
    boardSender?.stop();
    w.finish();
  };
  return { w, service, view, finish, leaf: (): FakeLeaf => opened.leaf!, vault, seen, surface, frames, screenOf, playerId: (): string => service.state?.playerId ?? '' };
}

beforeEach(() => {
  vi.useFakeTimers();
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
  vi.useRealTimers();
});

describe('an Obsidian player end to end', () => {
  it('joins, opens the tab, and sees the presented scene with nothing the GM hides', async () => {
    const { w, service, view, seen, surface, frames } = await joinFromObsidian();
    frames.run();
    const scene = seen.scenes.at(-1)!;
    expect(Object.keys(scene.tokens).sort()).toEqual(['ally', 'hero']);
    expect(scene.tokens.hero).toMatchObject({ name: 'Hero', x: 140, y: 140 });
    expect(Object.keys(scene.fog)).toEqual(['f1']);
    expect(JSON.stringify(scene)).not.toContain('art/');
    expect(view().contentEl.querySelector('.session-name')?.textContent).toBe('Vault');
    expect(view().contentEl.querySelector('.connection')?.textContent).toBe('Connected');
    expect(surface.calls.some((call) => call.op === 'begin')).toBe(true);
    service.dispose();
    w.finish();
  });

  it("moves a token the GM gave: one drop, the GM snaps it, and the player sees the GM's answer", async () => {
    const { w, service, view, playerId, screenOf, seen } = await joinFromObsidian();
    w.control.set('hero', playerId(), true);
    await w.tick();
    const canvas = view().contentEl.querySelector('canvas')!;
    const from = screenOf(140, 140);
    const to = screenOf(300, 150);
    pointer(canvas, 'pointerdown', from.x, from.y);
    pointer(canvas, 'pointermove', (from.x + to.x) / 2, (from.y + to.y) / 2);
    pointer(canvas, 'pointermove', to.x, to.y);
    pointer(canvas, 'pointerup', to.x, to.y);
    await w.tick();
    expect(w.token('hero')).toMatchObject({ x: 315, y: 175 });
    expect(seen.scenes.at(-1)!.tokens.hero).toMatchObject({ x: 315, y: 175 });
    service.dispose();
    w.finish();
  });

  it("rolls through the GM, into the GM's dice log and the player's", async () => {
    const { w, service, view } = await joinFromObsidian();
    expect(view().onlineControls()!.rollDice({ d20: 1 }, 2)).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.logged.at(-1)).toMatchObject({ formula: 'd20+2', rolledBy: 'Anna', total: 13 });
    const entries = [...view().contentEl.querySelectorAll('.dice-log-list .dice-entry')];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toContain('d20+2');
    expect(entries[0]!.textContent).toContain('13');
    // The player's own roll shows as a result card: no second three.js beside Atlas's.
    const card = view().contentEl.querySelector('.dice-toasts')!;
    expect(card.hasAttribute('hidden')).toBe(false);
    expect(card.textContent).toContain('13');
    service.dispose();
    w.finish();
  });

  it("a player's physical roll reaches the GM's log", async () => {
    const board = fakeDiceBoard([10, 4]);
    // The collection holding the tavern rolls d10s, and a 10 explodes once.
    const diceRules: OfferedDiceRules = { defaultRoll: '1d10', crit: 'natural', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 0 } };
    const { w, view, seen, finish } = await joinFromObsidian({ board: board.factory, diceRules });
    expect(view().contentEl.querySelector('[aria-label="Show 2D map"]')).not.toBeNull();
    expect(view().onlineControls()!.rollDice({ d10: 1 }, 3)).toBeNull();
    expect(board.throws).toEqual([{ dice: { d10: 1 }, modifier: 3 }]);
    // Nothing reaches the GM while the dice tumble: the 10 lands, the board asks for another d10, and it lands a 4.
    expect(w.logged).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(board.sent).toEqual([true]);
    await vi.advanceTimersByTimeAsync(0);
    expect(w.logged).toHaveLength(1);
    expect(w.logged[0]).toMatchObject({
      formula: 'd10+3', rolledBy: 'Anna', modifiers: 3, total: 17, crit: 'high',
      rolls: [{ die: 'd10', value: 10, max: 10, min: 1 }, { die: 'd10', value: 4, max: 10, min: 1, exploded: true }],
    });
    expect(w.logged[0]!.rolls[0]!.exploded).toBeUndefined();
    // The player's log shows the GM's reading of the dice, as the player's own roll.
    const mine = seen.logs.flat().find((entry) => entry.total === 17);
    expect(mine).toMatchObject({ name: 'Anna', mine: true, crit: 'high', modifier: 3 });
    expect(mine!.dice).toEqual([expect.objectContaining({ die: 'd10', value: 10 }), expect.objectContaining({ die: 'd10', value: 4, exploded: true })]);
    const entries = [...view().contentEl.querySelectorAll('.dice-log-list .dice-entry')];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toContain('17');
    finish();
  });

  it('old GM gets dice-roll: a GM that takes no physical rolls rolls the dice itself, though the player has a board that throws', async () => {
    const board = fakeDiceBoard([10, 4]);
    const { w, view, seen, finish } = await joinFromObsidian({ board: board.factory });
    expect(view().contentEl.querySelector('[aria-label="Show 2D map"]')).not.toBeNull();
    expect(view().onlineControls()!.rollDice({ d20: 1 }, 2)).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(board.throws).toEqual([]);
    expect(board.sent).toEqual([]);
    expect(w.logged).toHaveLength(1);
    expect(w.logged[0]).toMatchObject({ formula: 'd20+2', rolledBy: 'Anna', total: 13 });
    expect(seen.logs.flat().find((entry) => entry.total === 13)).toMatchObject({ name: 'Anna', mine: true });
    finish();
  });

  it("points the laser at the GM and sees the GM's", async () => {
    const { w, service, view, playerId, seen, screenOf, surface, frames } = await joinFromObsidian();
    // Laser is in the Move group's menu, as in Atlas.
    const laser = view().contentEl.querySelector<HTMLButtonElement>('[data-control="move"] .menu-entry[data-tool="laser"]')!;
    laser.click();
    const canvas = view().contentEl.querySelector('canvas')!;
    const at = screenOf(40, 50);
    pointer(canvas, 'pointerdown', at.x, at.y);
    pointer(canvas, 'pointermove', at.x + 5, at.y + 5);
    await vi.advanceTimersByTimeAsync(200);
    expect(w.shown().at(-1)).toMatchObject({ from: playerId(), lifted: false });
    pointer(canvas, 'pointerup', at.x + 5, at.y + 5);
    await vi.advanceTimersByTimeAsync(200);
    // The map draws it: the next frame has a beam over the GM's last point.
    const next = surface.calls.length;
    for (const [x, y] of [[70, 80], [90, 100], [110, 120]] as const) w.emitLocal({ kind: 'point', x, y });
    await vi.advanceTimersByTimeAsync(100);
    expect(seen.lasers.flatMap((laser) => laser.points)).toEqual(expect.arrayContaining([{ x: 110, y: 120 }]));
    frames.run();
    const beams = surface.calls.slice(next).filter((call) => call.op === 'raster');
    expect(beams.some((beam) => beam.x < 110 && beam.x + beam.width > 110 && beam.y < 120 && beam.y + beam.height > 120)).toBe(true);
    service.dispose();
    w.finish();
  });

  it("never writes the player's vault, and leaves cleanly", async () => {
    const { w, service, view, leaf, vault, playerId, screenOf } = await joinFromObsidian();
    w.control.set('hero', playerId(), true);
    await w.tick();
    const canvas = view().contentEl.querySelector('canvas')!;
    const from = screenOf(140, 140);
    pointer(canvas, 'pointerdown', from.x, from.y);
    pointer(canvas, 'pointerup', from.x + 30, from.y);
    view().onlineControls()!.rollDice({ d6: 2 }, 0);
    await w.tick();
    service.leave();
    await vi.advanceTimersByTimeAsync(0);
    for (const spy of [vault.create, vault.modify, vault.process, vault.read, vault.delete, vault.adapter.write, vault.adapter.read]) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(leaf().detach).toHaveBeenCalledOnce();
    expect(w.gm.getPlayers().map((player) => player.status)).toEqual(['gone']);
    service.dispose();
    w.finish();
  });
});
