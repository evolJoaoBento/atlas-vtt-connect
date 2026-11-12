/** The Canvas 2D scene tab: the player's view when Atlas has no remote view. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App, WorkspaceLeaf } from 'obsidian';
import { CanvasSceneView } from '../../../src/app/online/obsidian/CanvasSceneView';
import { joinedSessionStore } from '../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService, type OnlineSceneSink } from '../../../src/app/online/obsidian/OnlineJoinService';
import { ONLINE_SCENE_VIEW_TYPE } from '../../../src/app/online/obsidian/onlineSceneTab';
import { PAUSED_BANNER } from '../../../src/app/online/split/splitCopy';
import type { PlayerSessionState } from '../../../src/app/online/PlayerSession';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import { memorySettings } from '../connect/memorySettings';
import type { PlayerBoardFactory, PlayerBoardHandle, PlayerBoardHost } from '../../../src/app/online/obsidian/playerBoardContract';
import type { BoardCutscene } from '../../../src/app/online/scene/boardTypes';
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
  const focus: { view: unknown } = { view: null };
  const pending: Array<() => void> = [];
  return {
    leaves, pending, focus,
    getActiveViewOfType: (): unknown => focus.view,
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
  const drawing = { surface, frames, isHidden: () => false };
  function open(): { view: CanvasSceneView; leaf: FakeLeaf } {
    const leaf: FakeLeaf = { app, view: null, detach: vi.fn() };
    const view = new CanvasSceneView(leaf as unknown as WorkspaceLeaf, drawing);
    leaf.view = view;
    ws.leaves.push(leaf);
    return { view, leaf };
  }
  return { ws, app, service, attach, leave, sinks, sent, reconnect, surface, frames, open };
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

  it("claims Escape while it is the active tab, after its own handlers, so Obsidian does not leave it for the last note", async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    const escape = (): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event;
    };
    // Another tab has the keys: its Escape is Obsidian's.
    expect(escape().defaultPrevented).toBe(false);
    w.ws.focus.view = view;
    const sink = w.sinks[0]!;
    sink.session(admitted);
    sink.scene(playerScene());
    // Nothing of the scene's is open: Escape reaches Obsidian handled.
    const reached: KeyboardEvent[] = [];
    const obsidian = (event: KeyboardEvent): void => { reached.push(event); };
    window.addEventListener('keydown', obsidian);
    expect(escape().defaultPrevented).toBe(true);
    expect(reached.at(-1)?.defaultPrevented).toBe(true);
    // An open tray takes Escape itself and closes; Obsidian never hears it.
    const tray = view.contentEl.querySelector<HTMLElement>('.dice-tray')!;
    view.contentEl.querySelector<HTMLButtonElement>('.toolbar button[aria-label="Dice"]')?.click();
    expect(tray.hidden).toBe(false);
    const before = reached.length;
    escape();
    expect(tray.hidden).toBe(true);
    expect(reached.length).toBe(before);
    window.removeEventListener('keydown', obsidian);
    await view.onClose();
    // Closed: its Escape is Obsidian's again.
    expect(escape().defaultPrevented).toBe(false);
  });

  it('shows the paused banner over the map while the scene is paused', async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    const sink = w.sinks[0]!;
    sink.session(admitted);
    sink.scene(playerScene());
    sink.paused?.(true);
    w.frames.run();
    const notice = view.contentEl.querySelector<HTMLElement>('.move-notice');
    expect(notice?.textContent).toBe(PAUSED_BANNER);
    expect(notice?.hidden).toBe(false);
    sink.paused?.(false);
    w.frames.run();
    expect(notice?.hidden).toBe(true);
  });

  it('has Follow GM and Fit map as icon buttons of the toolbar, and a chevron at the left of the dice log to close it', async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    const toolbar = view.contentEl.querySelector<HTMLElement>('.toolbar')!;
    const follow = toolbar.querySelector<HTMLButtonElement>('button[aria-label="Follow GM"]')!;
    const fit = toolbar.querySelector<HTMLButtonElement>('button[aria-label="Fit map"]')!;
    // Icons, not words, and in the toolbar after the tools themselves.
    expect(follow.textContent).toBe('');
    expect(follow.querySelector('.tool-icon')).not.toBeNull();
    expect(fit.querySelector('.tool-icon')).not.toBeNull();
    expect(toolbar.lastElementChild).toBe(follow.parentElement);
    expect(view.contentEl.querySelector('.top-stack ~ .view-buttons, .table > .view-buttons')).toBeNull();
    const header = view.contentEl.querySelector('.dice-log-header')!;
    const close = header.querySelector<HTMLButtonElement>('button[aria-label="Close dice log"]')!;
    expect(header.firstElementChild).toBe(close);
    expect(close.textContent).toBe('');
    expect(close.querySelector('.tool-icon')).not.toBeNull();
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

  it('without the 3D board a GM that takes thrown dice still rolls the tray and the sheet', async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    const sheetRolls = vi.spyOn(w.service, 'sendSheetRoll').mockReturnValue(true);
    const results = vi.spyOn(w.service, 'sendDiceResult');
    const sink = w.sinks[0]!;
    sink.session(admitted);
    sink.boardOffer?.(true, { rules: null });
    sink.sheets?.([{ tokenId: 't1', name: 'Anna', resources: [], sheet: { name: 'Anna', subtitle: null, ac: null, hp: null, speed: null, stats: [10, 14, 10, 10, 10, 10], saves: [], skills: [], lines: [], sections: [] } }]);
    expect(view.onlineControls()!.rollDice({ d20: 1 }, 2)).toBeNull();
    expect(w.sent.rolls).toEqual([[{ d20: 1 }, 2]]);
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Roll DEX check"]')!.click();
    expect(sheetRolls).toHaveBeenCalledWith('t1', { kind: 'check', index: 1 });
    expect(results).not.toHaveBeenCalled();
  });

  it('lists the dice log and shows the own roll as a result card', async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    const sink = w.sinks[0]!;
    sink.session(admitted);
    sink.diceLog([roll]);
    expect(view.contentEl.querySelectorAll('.dice-log-list .dice-entry')).toHaveLength(1);
    expect(view.contentEl.querySelector('.dice-toasts')?.hasAttribute('hidden')).toBe(true);
    sink.ownRoll(roll);
    expect(view.contentEl.querySelector('.dice-toasts')?.hasAttribute('hidden')).toBe(false);
    expect(view.contentEl.querySelector('.dice-toasts .dice-card')).not.toBeNull();
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

  it('frees every document and window listener it added when the tab closes', async () => {
    const added: Array<{ target: string; signal: AbortSignal | undefined }> = [];
    for (const [name, target] of [['document', document], ['window', window]] as const) {
      const original = target.addEventListener.bind(target) as (...args: unknown[]) => void;
      vi.spyOn(target, 'addEventListener').mockImplementation(((type: string, listener: unknown, options?: AddEventListenerOptions | boolean) => {
        added.push({ target: name, signal: typeof options === 'object' ? options.signal : undefined });
        original(type, listener, options);
      }) as never);
    }
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    expect(added.length).toBeGreaterThan(0);
    expect(added.filter((entry) => entry.signal === undefined)).toEqual([]);
    expect(added.some((entry) => entry.signal?.aborted)).toBe(false);
    await view.onClose();
    expect(added.every((entry) => entry.signal?.aborted === true)).toBe(true);
  });

  it("does not take Escape from another pane: the dice log stays open and the key goes on, until this tab is active", async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    const later = vi.fn();
    document.addEventListener('keydown', later);
    const log = view.contentEl.querySelector<HTMLElement>('.dice-log')!;
    view.contentEl.querySelector<HTMLButtonElement>('.icon-button')!.click();
    expect(log.hidden).toBe(false);
    // Another pane has the keyboard.
    w.ws.focus.view = null;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(later).toHaveBeenCalledOnce();
    expect(log.hidden).toBe(false);
    // This tab has it: Escape closes the log and goes no further.
    w.ws.focus.view = view;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(log.hidden).toBe(true);
    expect(later).toHaveBeenCalledOnce();
    document.removeEventListener('keydown', later);
  });

  describe('keys belong to the tab only while it is the active view, in its own window', () => {
    const escape = (target: EventTarget = document): void => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };
    const control = (view: CanvasSceneView, label: string): HTMLButtonElement =>
      [...view.contentEl.querySelectorAll<HTMLButtonElement>('.tool-button')].find((button) => button.getAttribute('aria-label') === label)!;

    async function opened() {
      const w = world();
      const { view } = w.open();
      await view.onOpen();
      w.sinks[0]!.session(admitted);
      w.sinks[0]!.scene(playerScene());
      return { w, view, active: (on: boolean): void => { w.ws.focus.view = on ? view : null; } };
    }

    it("leaves a toolbar menu open when Escape is pressed in another pane", async () => {
      const { view, active } = await opened();
      view.contentEl.querySelector<HTMLButtonElement>('.tool-chevron')!.click();
      const flyout = view.contentEl.querySelector<HTMLElement>('.toolbar-menu:not([hidden])');
      expect(flyout).not.toBeNull();
      active(false);
      escape();
      expect(flyout!.hidden).toBe(false);
      active(true);
      escape();
      expect(flyout!.hidden).toBe(true);
    });

    it('keeps the laser tool on Escape in another pane, and returns to Move on Escape in the tab', async () => {
      const { view, active } = await opened();
      // Laser is in the Move group's menu, as in Atlas.
      view.contentEl.querySelector<HTMLButtonElement>('[data-control="move"] .menu-entry[data-tool="laser"]')!.click();
      const canvas = view.contentEl.querySelector('canvas')!;
      expect(canvas.dataset.tool).toBe('laser');
      active(false);
      escape();
      expect(canvas.dataset.tool).toBe('laser');
      active(true);
      escape();
      expect(canvas.dataset.tool).toBe('move');
    });

    it('keeps the dice tray open on Escape in another pane, and closes it in the tab', async () => {
      const { view, active } = await opened();
      control(view, 'Dice').click();
      const tray = view.contentEl.querySelector<HTMLElement>('.dice-tray')!;
      expect(tray.hidden).toBe(false);
      active(false);
      escape();
      expect(tray.hidden).toBe(false);
      active(true);
      escape();
      expect(tray.hidden).toBe(true);
    });

    it("takes Escape from the tab's own document, not the main window's, so a popout works", async () => {
      const w = world();
      const { view } = w.open();
      const popout = document.implementation.createHTMLDocument('popout');
      view.contentEl = popout.body.createDiv();
      await view.onOpen();
      w.ws.focus.view = view;
      const log = view.contentEl.querySelector<HTMLElement>('.dice-log')!;
      view.contentEl.querySelector<HTMLButtonElement>('.icon-button')!.click();
      expect(log.hidden).toBe(false);
      escape(document);
      expect(log.hidden).toBe(false);
      escape(popout);
      expect(log.hidden).toBe(true);
    });
  });

  it('shows a session the GM ended or a kick in its status bar, without Reconnect', async () => {
    const w = world();
    const { view } = w.open();
    await view.onOpen();
    const text = (selector: string): string | undefined => view.contentEl.querySelector(selector)?.textContent ?? undefined;
    const reconnect = view.contentEl.querySelector<HTMLButtonElement>('button.secondary')!;
    w.sinks[0]!.session({ ...admitted, status: 'lost', reason: 'ended' });
    expect(text('.connection')).toBe('Disconnected');
    expect(text('.scene-message')).toBe('The session ended.');
    expect(reconnect.hidden).toBe(true);
    w.sinks[0]!.session({ ...admitted, status: 'denied', reason: 'kicked' });
    expect(text('.scene-message')).toBe('The GM removed you from the session.');
    expect(reconnect.hidden).toBe(true);
  });
});

const cutscene: BoardCutscene = {
  runId: 'run1', mode: 'prepared', look: { bars: 2.39, fadeMs: 600 },
  shots: [{ key: 'k1', eye: { x: 0, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 }, at: 0, keyframe: false, transition: 'fade' }],
  step: { shot: 0, seq: 1 }, key: 'k1',
};

/** A board factory that plays cutscenes (or says it does not) and records what the tab asks of the handle, in order. */
function cutsceneFactory(plays = true) {
  const calls: string[] = [];
  const cutscenes: Array<{ cutscene: unknown; options: unknown }> = [];
  let host: PlayerBoardHost | null = null;
  let created = 0;
  let disposed = 0;
  const handle = new Proxy({} as PlayerBoardHandle, {
    get: (_target, name: string) => {
      if (name === 'cutscenes') return plays ? true : undefined;
      if (name === 'setCutscene') return plays ? (value: unknown, options?: unknown) => { calls.push(value === null ? 'setCutscene:null' : 'setCutscene'); cutscenes.push({ cutscene: value, options }); } : undefined;
      if (name === 'setCutsceneScene') return plays ? () => { calls.push('setCutsceneScene'); } : undefined;
      if (name === 'setCutsceneCamera') return plays ? () => { calls.push('setCutsceneCamera'); } : undefined;
      if (name === 'dispose') return () => { disposed++; calls.push('dispose'); };
      if (name === 'toolState') return () => ({ tool: 'move', shape: 'line', templateShape: 'circle', ownTemplates: false, laserColor: '#fff', gmView: true });
      return (...args: unknown[]) => { calls.push(`${name}${args.length && typeof args[0] === 'string' ? `:${args[0]}` : ''}`); };
    },
  });
  const factory: PlayerBoardFactory = { version: 1, create: (_parent, given) => { host = given; created++; calls.push('create'); return handle; } };
  return { factory, calls, cutscenes, host: () => host!, created: () => created, disposed: () => disposed };
}

describe('cutscenes in the player tab', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function playing(options: { factory?: ReturnType<typeof cutsceneFactory> | null } = {}) {
    const w = world();
    const given = options.factory === undefined ? cutsceneFactory() : options.factory;
    vi.spyOn(w.service, 'boardPainter').mockImplementation(() => given?.factory ?? null);
    const ready: boolean[] = [];
    vi.spyOn(w.service, 'sendCutsceneReady').mockImplementation((on) => { ready.push(on); return true; });
    const { view } = w.open();
    await view.onOpen();
    const sink = w.sinks[0]!;
    sink.session(admitted);
    sink.scene(playerScene());
    const q = <T extends HTMLElement>(selector: string): T => view.contentEl.querySelector<T>(selector)!;
    const scene = (): { map: { camera: { current(): unknown; pan(dx: number, dy: number): void } } | null } => (view as unknown as { scene: { map: never } }).scene as never;
    return { w, view, sink, ready, given, q, scene };
  }

  it('a 2D player with a factory gets a board on cutscene, made with startBlack and handBack before its first scene, and asks for the reveal', async () => {
    const t = await playing();
    t.sink.cutscene?.(cutscene);
    expect(t.ready).toEqual([true]);
    const overlay = t.q('.atlas-connect-scene__cutscene-overlay');
    expect(overlay.hidden).toBe(false);
    expect(overlay.classList.contains('is-black')).toBe(true);
    // The board is made now but shows (and plays) only once the picture is black.
    expect(t.q('.atlas-connect-scene__board').hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    const calls = t.given!.calls;
    expect(t.given!.cutscenes[0]).toEqual({ cutscene, options: { startBlack: true, handBack: true } });
    expect(calls.indexOf('setCutscene')).toBeGreaterThan(calls.indexOf('create'));
    expect(calls.indexOf('setCutscene')).toBeLessThan(calls.indexOf('setScene'));
    expect(t.q('.atlas-connect-scene__board').hidden).toBe(false);
    expect(t.q('canvas').hidden).toBe(true);
    // The overlay stays under the board.
    expect(overlay.classList.contains('is-black')).toBe(true);
    t.sink.cutsceneScene?.('run1', 'k1', playerScene({ sceneId: 'cutscene:run1:k1' }), null);
    expect(t.given!.calls).toContain('setCutsceneScene');
  });

  it('the 2D map is the same instance after the run, with the player\'s own pan and zoom, and the board goes only after cutsceneOver', async () => {
    const t = await playing();
    const map = t.scene().map!;
    map.camera.pan(40, 25);
    const own = JSON.parse(JSON.stringify(map.camera.current()));
    t.sink.cutscene?.(cutscene);
    await vi.advanceTimersByTimeAsync(600);
    // The GM's camera moves on meanwhile; it is not the player's.
    t.sink.camera({ sceneId: playerScene().sceneId, centerX: 900, centerY: 900, zoom: 3 } as never);
    t.sink.cutscene?.(null);
    expect(t.given!.cutscenes.at(-1)).toEqual({ cutscene: null, options: { handBack: true } });
    // The board fades to black by itself; until it says it is over, it stays and so does the black.
    expect(t.given!.disposed()).toBe(0);
    expect(t.q('.atlas-connect-scene__board').hidden).toBe(false);
    expect(t.q('.atlas-connect-scene__cutscene-overlay').classList.contains('is-black')).toBe(true);
    t.given!.host().cutsceneOver?.();
    expect(t.given!.disposed()).toBe(1);
    expect(t.q('canvas').hidden).toBe(false);
    expect(t.q('.atlas-connect-scene__board').hidden).toBe(true);
    // Under the black the map is shown; the overlay fades out over fadeMs.
    const overlay = t.q('.atlas-connect-scene__cutscene-overlay');
    expect(overlay.classList.contains('is-black')).toBe(false);
    expect(overlay.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(overlay.hidden).toBe(true);
    expect(t.scene().map).toBe(map);
    expect(map.camera.current()).toEqual(own);
    expect(t.ready).toEqual([true, false]);
  });

  it('the toolbar is hidden during the run and shown after', async () => {
    const t = await playing();
    const toolbar = t.q('.toolbar');
    expect(toolbar.hidden).toBe(false);
    t.sink.cutscene?.(cutscene);
    expect(toolbar.hidden).toBe(true);
    expect(t.view.contentEl.querySelector('.atlas-connect-scene')!.classList.contains('is-cutscene')).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    t.sink.cutscene?.(null);
    t.given!.host().cutsceneOver?.();
    await vi.advanceTimersByTimeAsync(600);
    expect(toolbar.hidden).toBe(false);
    expect(t.view.contentEl.querySelector('.atlas-connect-scene')!.classList.contains('is-cutscene')).toBe(false);
  });

  it('without a factory the curtain shows, the tools lock, and no cutscene-ready is sent', async () => {
    const t = await playing({ factory: null });
    t.sink.cutscene?.(cutscene);
    const curtain = t.q('.atlas-connect-scene__cutscene-curtain');
    expect(curtain.hidden).toBe(false);
    expect(curtain.textContent).toBe('The GM is showing a scene.');
    expect(t.q('.toolbar').hidden).toBe(true);
    expect(t.ready).toEqual([]);
    t.sink.cutsceneScene?.('run1', 'k1', playerScene({ sceneId: 'cutscene:run1:k1' }), null);
    t.sink.cutscene?.(null);
    expect(curtain.hidden).toBe(true);
    expect(t.q('.toolbar').hidden).toBe(false);
    expect(t.ready).toEqual([]);
  });

  it('a board that does not play cutscenes gets the curtain too, and is not kept', async () => {
    const t = await playing({ factory: cutsceneFactory(false) });
    t.sink.cutscene?.(cutscene);
    expect(t.q('.atlas-connect-scene__cutscene-curtain').hidden).toBe(false);
    expect(t.ready).toEqual([]);
    expect(t.given!.disposed()).toBe(1);
  });

  it('a player already on the board is handed the run, with startBlack when the run is already past its first step', async () => {
    const t = await playing();
    t.sink.boardOffer?.(true);
    expect(t.given!.created()).toBe(1);
    t.sink.cutscene?.({ ...cutscene, step: { shot: 1, seq: 3 } });
    expect(t.given!.cutscenes[0]!.options).toEqual({ startBlack: true });
    expect(t.ready).toEqual([true]);
    t.sink.cutscene?.(null);
    expect(t.given!.cutscenes.at(-1)).toEqual({ cutscene: null, options: undefined });
    // A run from its start gets no startBlack: the board fades to black itself.
    t.sink.cutscene?.({ ...cutscene, runId: 'run2' });
    expect(t.given!.cutscenes.at(-1)!.options).toBeUndefined();
    // The player did not leave their board for a hand-back one.
    expect(t.given!.created()).toBe(1);
  });

  it('ends an aborted run while waiting: the overlay fades out and the map is back with no board shown', async () => {
    const t = await playing();
    t.sink.cutscene?.(cutscene);
    // The GM aborts before the picture is even black.
    await vi.advanceTimersByTimeAsync(100);
    t.sink.cutscene?.(null);
    expect(t.given!.disposed()).toBe(1);
    expect(t.q('canvas').hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(t.q('.atlas-connect-scene__cutscene-overlay').hidden).toBe(true);
    expect(t.q('.toolbar').hidden).toBe(false);
  });

  it('a board that never reaches its black does not keep the player locked', async () => {
    const t = await playing();
    t.sink.cutscene?.(cutscene);
    await vi.advanceTimersByTimeAsync(600);
    t.sink.cutscene?.(null);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.given!.disposed()).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(t.q('.toolbar').hidden).toBe(false);
  });

  it('after a drop the run is over for the tab, and the GM resending it on the new admission asks for the reveal again', async () => {
    const t = await playing();
    t.sink.cutscene?.(cutscene);
    // The real session ends the run when the link drops, then the GM's `cutscene` follows the new admission.
    t.sink.session({ ...admitted, status: 'connecting' });
    t.sink.cutscene?.(null);
    t.sink.session(admitted);
    t.sink.cutscene?.(cutscene);
    // Not admitted, nothing to take back (the GM forgot the old link); the new run asks anew.
    expect(t.ready).toEqual([true, true]);
  });

  it('the black fades in: the overlay is shown and its style flushed before the class that moves its opacity', async () => {
    const t = await playing();
    const overlay = t.q('.atlas-connect-scene__cutscene-overlay');
    const reads: Array<{ hidden: boolean; black: boolean }> = [];
    Object.defineProperty(overlay, 'offsetHeight', { configurable: true, get: () => { reads.push({ hidden: overlay.hidden, black: overlay.classList.contains('is-black') }); return 0; } });
    t.sink.cutscene?.(cutscene);
    expect(reads[0]).toEqual({ hidden: false, black: false });
    expect(overlay.classList.contains('is-black')).toBe(true);
  });

  it('closing the tab mid-run tells the GM to stop sending the reveal', async () => {
    const t = await playing();
    t.sink.cutscene?.(cutscene);
    await t.view.onClose();
    expect(t.ready).toEqual([true, false]);
  });

  it('the view does not change during the run and is chosen anew after it', async () => {
    const t = await playing();
    t.sink.cutscene?.(cutscene);
    await vi.advanceTimersByTimeAsync(600);
    // The GM offers the board meanwhile: nothing swaps under the run.
    t.sink.boardOffer?.(true);
    expect(t.given!.created()).toBe(1);
    t.sink.cutscene?.(null);
    t.given!.host().cutsceneOver?.();
    await vi.advanceTimersByTimeAsync(600);
    // Now the offer takes effect: a board for the player's own view.
    expect(t.given!.created()).toBe(2);
  });
});
