/** The join page's scene switch in a cutscene: the chunk, the hand-back flow, the curtain and room AR's Back to AR. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneSwitch, type SceneSwitchOptions } from '../../../online-client/sceneSwitch.mts';
import type { BoardSceneView } from '../../../src/app/online/obsidian/BoardSceneView';
import type { PlayerBoardFactory } from '../../../src/app/online/obsidian/playerBoardContract';
import type { SceneViewport } from '../../../src/app/online/obsidian/sceneViewport';
import type { BoardCutscene } from '../../../src/app/online/scene/boardTypes';

const run: BoardCutscene = {
  runId: 'run1', mode: 'prepared', look: { bars: 2.39, fadeMs: 600 },
  shots: [{ key: 'k1', eye: { x: 0, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 }, at: 0, keyframe: false, transition: 'fade' }],
  step: { shot: 0, seq: 1 }, key: 'k1',
};

/** A viewport that records its calls; `plays` makes it a board that plays cutscenes. */
function fakeView(plays: boolean, calls: string[]) {
  return new Proxy({}, {
    get: (_target, name: string) => {
      if (name === 'playsCutscenes') return plays;
      if (name === 'firstPerson' || name === 'augmentedReality' || name === 'roomAr') return false;
      if (name === 'seeingFrom') return () => null;
      if (name === 'toolState') return () => ({ tool: 'move' });
      return (...args: unknown[]) => { calls.push(`${name}${typeof args[0] === 'string' ? `:${args[0]}` : ''}`); };
    },
  }) as unknown as BoardSceneView & SceneViewport;
}

function page(options: { factoryNow?: boolean } = {}) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, hidden = false): HTMLElementTagNameMap[K] => {
    const made = document.createElement(tag);
    made.hidden = hidden;
    document.body.append(made);
    return made;
  };
  const canvas = el('canvas');
  const boardEl = el('div', true);
  const overlay = el('div', true);
  const curtain = el('div', true);
  const back = el('button', true);
  const ready: boolean[] = [];
  const locks: boolean[] = [];
  const boardCalls: string[] = [];
  const made: Array<{ over: (() => void) | undefined }> = [];
  let resolveBoard: (factory: PlayerBoardFactory) => void = () => {};
  let loads = 0;
  const factory: PlayerBoardFactory = { version: 1, create: () => { throw new Error('not used: makeBoard is faked'); } };
  const switchOptions: SceneSwitchOptions = {
    makeMap: () => fakeView(false, []),
    makeBoard: (_factory, _parent, over) => { made.push({ over }); return fakeView(true, boardCalls); },
    loadBoard: () => {
      loads++;
      return options.factoryNow ? Promise.resolve(factory) : new Promise<PlayerBoardFactory>((resolve) => { resolveBoard = resolve; });
    },
    canvas, boardEl, dimensionButton: el('button'), eyeButton: el('button'), eyeMenu: el('div'), viewButtons: el('div'),
    requestBoard: () => true, onViewChange: () => {}, tokenName: () => 'T',
    cutscene: { overlay, curtain, backButton: back, sendReady: (on) => { ready.push(on); return true; }, onLock: (locked) => { locks.push(locked); } },
  };
  const sw = new SceneSwitch(switchOptions);
  return { sw, canvas, boardEl, overlay, curtain, back, ready, locks, boardCalls, made, loads: () => loads, load: (): void => resolveBoard(factory) };
}

describe('SceneSwitch and a cutscene', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

  it('a page that has not the board yet loads it for the run and shows the curtain, then plays the run on the board when it arrives', async () => {
    const p = page();
    p.sw.cutscene(run);
    expect(p.loads()).toBe(1);
    expect(p.curtain.hidden).toBe(false);
    expect(p.curtain.textContent).toBe('The GM is showing a scene.');
    expect(p.ready).toEqual([]);
    expect(p.locks).toEqual([true]);
    // The chunk arrives mid-run: the curtain gives way to the hand-back flow.
    p.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.ready).toEqual([true]);
    expect(p.made).toHaveLength(1);
    expect(p.overlay.classList.contains('is-black')).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(p.boardCalls).toContain('setCutscene');
    expect(p.boardEl.hidden).toBe(false);
    expect(p.curtain.hidden).toBe(true);
    p.sw.cutscene(null);
    p.made[0]!.over!();
    await vi.advanceTimersByTimeAsync(600);
    expect(p.locks.at(-1)).toBe(false);
    expect(p.canvas.hidden).toBe(false);
  });

  it('with the board already here the run is played at once, and the chunk is not asked for twice', async () => {
    const p = page({ factoryNow: true });
    p.sw.boardOffer(false);
    p.sw.cutscene(run);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.loads()).toBe(1);
    expect(p.ready).toEqual([true]);
    expect(p.curtain.hidden).toBe(true);
  });

  it('a run that ends before the chunk arrives frees the player, and the late chunk starts nothing', async () => {
    const p = page();
    p.sw.cutscene(run);
    p.sw.cutscene(null);
    expect(p.curtain.hidden).toBe(true);
    expect(p.locks).toEqual([true, false]);
    p.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.made).toHaveLength(0);
    expect(p.ready).toEqual([]);
  });

  describe('room AR', () => {
    function withAr() {
      const p = page({ factoryNow: true });
      const ar = { roomActive: true, roomSuspended: false, suspendRoom: vi.fn(() => { ar.roomSuspended = true; ar.roomActive = false; }), resumeRoom: vi.fn(), end: vi.fn() };
      (p.sw as unknown as { ar: unknown }).ar = ar;
      return { p, ar };
    }

    it('stops room tracking when a run starts, offers Back to AR only after the fade out, and a tap restarts it', async () => {
      const { p, ar } = withAr();
      p.sw.cutscene(run);
      expect(ar.suspendRoom).toHaveBeenCalledOnce();
      expect(p.back.hidden).toBe(true);
      p.sw.cutscene(null);
      // The board is still fading out and giving the camera back: a tap now could not start a session.
      await vi.advanceTimersByTimeAsync(599);
      expect(p.back.hidden).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(p.back.hidden).toBe(false);
      const session = Promise.resolve({});
      const request = vi.fn(() => session);
      Object.defineProperty(navigator, 'xr', { configurable: true, value: { requestSession: request } });
      p.back.click();
      expect(request).toHaveBeenCalledWith('immersive-ar', expect.anything());
      expect(ar.resumeRoom).toHaveBeenCalledWith(session);
      expect(p.back.hidden).toBe(true);
      delete (navigator as unknown as Record<string, unknown>).xr;
    });

    it('a second run hides Back to AR again', async () => {
      const { p } = withAr();
      p.sw.cutscene(run);
      p.sw.cutscene(null);
      await vi.advanceTimersByTimeAsync(600);
      expect(p.back.hidden).toBe(false);
      p.sw.cutscene({ ...run, runId: 'run2' });
      expect(p.back.hidden).toBe(true);
    });

    it('marker AR is left running: nothing to suspend and no button', async () => {
      const { p, ar } = withAr();
      ar.roomActive = false;
      ar.suspendRoom.mockImplementation(() => undefined);
      p.sw.cutscene(run);
      p.sw.cutscene(null);
      await vi.advanceTimersByTimeAsync(600);
      expect(p.back.hidden).toBe(true);
      expect(ar.end).not.toHaveBeenCalled();
    });
  });
});
