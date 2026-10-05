/**
 * An Obsidian player against the real GM side over `MemoryTransport`: the join service and the Canvas 2D scene tab
 * (`CanvasSceneView`), with the GM's session, scene broadcaster, token control, dice host and laser relay
 * (`toolsWorld`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import type { ImageDecoder } from '../../../../src/app/online/assets/AssetLoader';
import { CanvasSceneView } from '../../../../src/app/online/obsidian/CanvasSceneView';
import { joinedSessionStore } from '../../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService, type OnlineSceneSink } from '../../../../src/app/online/obsidian/OnlineJoinService';
import { ONLINE_SCENE_VIEW_TYPE } from '../../../../src/app/online/obsidian/onlineSceneTab';
import type { PlayerScene } from '../../../../src/app/online/scene/sceneTypes';
import type { PlayerLaser } from '../../../../src/app/online/tools/toolMessages';
import { memorySettings } from '../../connect/memorySettings';
import { nodeHash } from '../assetFixtures';
import { fakeFrames, RecordingSurface } from '../recordingSurface';
import { toolsWorld } from '../toolsFixtures';

type FakeLeaf = { app: unknown; view: unknown; detach: ReturnType<typeof vi.fn> };

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

/** The GM presents the tavern; Anna joins from Obsidian, is let in, and her scene tab opens and attaches. */
async function joinFromObsidian() {
  const w = toolsWorld();
  w.present();
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
  const throws = { throwRoll: vi.fn(() => true) };
  const seen = { scenes: [] as Array<PlayerScene | null>, lasers: [] as PlayerLaser[] };
  const decode: ImageDecoder = async () => null;
  const opened: { view: CanvasSceneView | null; leaf: FakeLeaf | null } = { view: null, leaf: null };
  const service: OnlineJoinService = new OnlineJoinService(app, memorySettings(), '0.1.0', {
    createClient: () => w.network.client(), openStore: async () => null, decode, hash: nodeHash, isHosting: () => false,
    openSceneTab: async () => {
      const leaf: FakeLeaf = { app, view: null, detach: vi.fn() };
      const view = new CanvasSceneView(leaf as unknown as WorkspaceLeaf, { surface, frames, isHidden: () => false, loadThrows: async () => throws });
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
    diceLog: (entries) => sink.diceLog(entries),
    ownRoll: (entry) => sink.ownRoll(entry),
    laser: (laser) => { seen.lasers.push(laser); sink.laser(laser); },
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
  return { w, service, view, leaf: (): FakeLeaf => opened.leaf!, vault, seen, surface, frames, throws, screenOf, playerId: (): string => service.state?.playerId ?? '' };
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
    const { w, service, view, throws } = await joinFromObsidian();
    expect(view().onlineControls()!.rollDice({ d20: 1 }, 2)).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.logged.at(-1)).toMatchObject({ formula: 'd20+2', rolledBy: 'Anna', total: 13 });
    const entries = [...view().contentEl.querySelectorAll('.dice-log-list .dice-entry')];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.textContent).toContain('d20+2');
    expect(entries[0]!.textContent).toContain('13');
    // The player's own roll is thrown as dice, not toasted.
    await vi.waitFor(() => expect(throws.throwRoll).toHaveBeenCalledOnce());
    service.dispose();
    w.finish();
  });

  it("points the laser at the GM and sees the GM's", async () => {
    const { w, service, view, playerId, seen, screenOf } = await joinFromObsidian();
    const laser = [...view().contentEl.querySelectorAll<HTMLButtonElement>('.tool-button')].find((button) => button.getAttribute('aria-label') === 'Laser')!;
    laser.click();
    const canvas = view().contentEl.querySelector('canvas')!;
    const at = screenOf(40, 50);
    pointer(canvas, 'pointerdown', at.x, at.y);
    pointer(canvas, 'pointermove', at.x + 5, at.y + 5);
    await vi.advanceTimersByTimeAsync(200);
    expect(w.shown().at(-1)).toMatchObject({ from: playerId(), lifted: false });
    pointer(canvas, 'pointerup', at.x + 5, at.y + 5);
    await vi.advanceTimersByTimeAsync(200);
    w.emitLocal({ kind: 'point', x: 70, y: 80 });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.lasers.at(-1)).toMatchObject({ from: 'gm', points: [{ x: 70, y: 80 }] });
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
