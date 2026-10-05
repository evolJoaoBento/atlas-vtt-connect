/** The Canvas 2D scene tab: the player's view when Atlas has no remote view. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { CanvasSceneView } from '../../../src/app/online/obsidian/CanvasSceneView';
import { joinedSessionStore } from '../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService, type OnlineSceneSink } from '../../../src/app/online/obsidian/OnlineJoinService';
import { ONLINE_SCENE_VIEW_TYPE } from '../../../src/app/online/obsidian/onlineSceneTab';
import type { PlayerSessionState } from '../../../src/app/online/PlayerSession';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import { memorySettings } from '../connect/memorySettings';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

type FakeLeaf = { app: unknown; view: unknown; detach: ReturnType<typeof vi.fn> };

const admitted: PlayerSessionState = { status: 'admitted', playerId: 'me', title: 'Vault', players: [{ playerId: 'me', name: 'Anna', connected: true }], reason: null };
const roll: DiceLogEntry = { id: 'r1', name: 'Anna', formula: 'd20', dice: [{ die: 'd20', value: 11 }], modifier: 0, total: 11, at: 1, mine: true };

beforeEach(() => {
  // jsdom lays nothing out: the canvas is 800 x 600.
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

/** A workspace whose layout becomes ready when `ready()` runs (or at once, as for a started Obsidian). */
function workspace(layoutReady = true) {
  const leaves: FakeLeaf[] = [];
  const pending: Array<() => void> = [];
  return {
    leaves, pending,
    revealLeaf: vi.fn(),
    getLeavesOfType: (type: string): FakeLeaf[] => (type === ONLINE_SCENE_VIEW_TYPE ? leaves : []),
    onLayoutReady: (callback: () => void): void => { if (layoutReady) callback(); else pending.push(callback); },
    ready: (): void => { pending.splice(0).forEach((callback) => callback()); },
  };
}

function world(ws = workspace()) {
  const app = { workspace: ws } as unknown as App;
  const service = new OnlineJoinService(app, memorySettings(), '0.1.0', { openStore: async () => null, isHosting: () => false });
  const sinks: OnlineSceneSink[] = [];
  const attach = vi.spyOn(service, 'attach').mockImplementation((sink) => {
    sinks.push(sink);
    return () => undefined;
  });
  const leave = vi.spyOn(service, 'leave');
  const sent = { rolls: [] as Array<[unknown, number]> };
  vi.spyOn(service, 'sendDiceRoll').mockImplementation((dice, modifier) => { sent.rolls.push([dice, modifier]); return true; });
  const reconnect = vi.spyOn(service, 'reconnect').mockReturnValue(null);
  const surface = new RecordingSurface();
  const frames = fakeFrames();
  const throws = { throwRoll: vi.fn(() => true) };
  const drawing = { surface, frames, isHidden: () => false, loadThrows: async () => throws };
  function open(): { view: CanvasSceneView; leaf: FakeLeaf } {
    const leaf: FakeLeaf = { app, view: null, detach: vi.fn() };
    const view = new CanvasSceneView(leaf as unknown as WorkspaceLeaf, drawing);
    leaf.view = view;
    ws.leaves.push(leaf);
    return { view, leaf };
  }
  return { ws, app, service, attach, leave, sinks, sent, reconnect, surface, frames, throws, open };
}

describe('CanvasSceneView', () => {
  it('is not a navigation target, so opening a file or going back never replaces it', () => {
    expect(world().open().view.navigation).toBe(false);
  });

  it('draws the joined scene into its canvas, with the status and what the GM sent', async () => {
    const w = world();
    const { view, leaf } = w.open();
    await view.onOpen();
    expect(view.isAttached).toBe(true);
    expect(view.getViewType()).toBe('atlas-vtt-connect-scene');
    const sink = w.sinks[0]!;
    sink.session(admitted);
    sink.scene(playerScene());
    w.frames.run();
    expect(w.surface.calls.find((call) => call.op === 'begin')).toMatchObject({ width: 800, height: 600 });
    expect(w.surface.calls.some((call) => call.op === 'rect' || call.op === 'circle' || call.op === 'roundRect')).toBe(true);
    expect(view.contentEl.querySelector('.session-name')?.textContent).toBe('Vault');
    expect(view.contentEl.querySelector('.connection')?.textContent).toBe('Connected');
    expect(leaf.detach).not.toHaveBeenCalled();
  });

  it('closing the tab leaves the session', async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    await view.onClose();
    expect(w.leave).toHaveBeenCalledOnce();
  });

  it('leaves the session when it closes before it attached', async () => {
    const w = world(workspace(false));
    const { view } = w.open();
    await view.onOpen();
    await view.onClose();
    w.ws.ready();
    expect(view.isAttached).toBe(false);
    expect(w.leave).toHaveBeenCalledOnce();
    expect(w.attach).not.toHaveBeenCalled();
  });

  it('a second tab gives way to the first, without ending the session', async () => {
    const w = world();
    const first = w.open();
    await first.view.onOpen();
    const copy = w.open();
    await copy.view.onOpen();
    expect(copy.leaf.detach).toHaveBeenCalledOnce();
    expect(w.ws.revealLeaf).toHaveBeenCalledWith(first.leaf);
    expect(copy.view.isAttached).toBe(false);
    expect(w.attach).toHaveBeenCalledOnce();
    await copy.view.onClose();
    expect(w.leave).not.toHaveBeenCalled();
    expect(first.view.onlineControls()).not.toBeNull();
    await first.view.onClose();
    expect(w.leave).toHaveBeenCalledOnce();
  });

  it('with no session the tab closes itself once the layout is ready, and not before', async () => {
    const w = world(workspace(false));
    w.attach.mockRestore();
    const { view, leaf } = w.open();
    await view.onOpen();
    expect(leaf.detach).not.toHaveBeenCalled();
    w.ws.ready();
    expect(leaf.detach).toHaveBeenCalledOnce();
    expect(view.isAttached).toBe(false);
  });

  it('closes itself when the session is left from elsewhere', async () => {
    const w = world();
    const { view, leaf } = w.open();
    await view.onOpen();
    w.sinks[0]!.close();
    expect(leaf.detach).toHaveBeenCalledOnce();
  });

  it('keeps nothing of the session in the workspace and never loads a file', () => {
    const { view } = world().open();
    expect(view.getState()).toEqual({});
    return expect(view.setState()).resolves.toBeUndefined();
  });

  it("sends the player's roll from the dice tray, and says why a roll could not go", async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    w.sinks[0]!.session(admitted);
    expect(view.onlineControls()!.rollDice({ d20: 1 }, 2)).toBeNull();
    expect(w.sent.rolls).toEqual([[{ d20: 1 }, 2]]);
    vi.spyOn(w.service, 'sendDiceRoll').mockReturnValue(false);
    w.sinks[0]!.session({ ...admitted, status: 'waiting' });
    expect(view.onlineControls()!.rollDice({ d20: 1 }, 0)).toBe("The GM hasn't let you in yet.");
  });

  it('lists the dice log, throws the own roll as 3D dice and toasts it when it cannot be thrown', async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    const sink = w.sinks[0]!;
    sink.session(admitted);
    sink.diceLog([roll]);
    expect(view.contentEl.querySelectorAll('.dice-log-list .dice-entry')).toHaveLength(1);
    sink.ownRoll(roll);
    await vi.waitFor(() => expect(w.throws.throwRoll).toHaveBeenCalledOnce());
    expect(view.contentEl.querySelector('.dice-toast')?.hasAttribute('hidden')).toBe(true);
    w.throws.throwRoll.mockReturnValue(false);
    sink.ownRoll({ ...roll, id: 'r2' });
    await vi.waitFor(() => expect(view.contentEl.querySelector('.dice-toast')?.hasAttribute('hidden')).toBe(false));
  });

  it('offers Reconnect once the connection was lost', async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    const button = view.contentEl.querySelector<HTMLButtonElement>('button.secondary')!;
    expect(button.textContent).toBe('Reconnect');
    expect(button.hidden).toBe(true);
    w.sinks[0]!.session({ ...admitted, status: 'lost', reason: 'connection-lost' });
    expect(button.hidden).toBe(false);
    button.click();
    expect(w.reconnect).toHaveBeenCalledOnce();
  });
});
