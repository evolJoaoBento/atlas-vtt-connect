import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FUSION_PROTOCOL } from '../../../src/app/online/scene/boardTypes';
import { tabletopBoard } from '../../../src/connect/tabletopMinis';

function fakeApp() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const plugins: Record<string, { api?: unknown }> = {};
  const manifests: Record<string, { version: string }> = { 'atlas-vtt-tabletop': { version: '1.3.0' }, 'tabletop-for-atlas': { version: '1.3.0' }, 'atlas-vtt-connect': { version: '0.9.0' } };
  const app = {
    plugins: { plugins, manifests },
    workspace: {
      on: (name: string, handler: (...args: unknown[]) => void) => {
        const set = handlers.get(name) ?? new Set();
        handlers.set(name, set);
        set.add(handler);
        return { name, handler };
      },
      offref: (ref: { name: string; handler: (...args: unknown[]) => void }) => { handlers.get(ref.name)?.delete(ref.handler); },
      trigger: (name: string, ...args: unknown[]) => { for (const handler of [...(handlers.get(name) ?? [])]) handler(...args); },
    },
  };
  return { app: app as unknown as App, plugins, trigger: app.workspace.trigger };
}

const LOOK = {
  wallHeight: () => 2, wallMaterial: () => null, doorProp: () => null, lightHeight: () => null,
  fogHeight: 1, wallThickness: 0.12, ambient: null, props: [], materials: [],
};

function fakeTabletop(overrides: Record<string, unknown> = {}) {
  const board = new Set<(mapPath: string | null) => void>();
  const camera = new Set<() => void>();
  let pose: unknown = { eye: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } };
  return {
    api: {
      version: 1,
      fusion: 3,
      placementsFor: () => ({}),
      onChange: () => () => undefined,
      boardLook: (mapPath: string) => (mapPath === 'm.atlasmap' ? LOOK : { ...LOOK, fogHeight: 3 }),
      onBoardChange: (listener: (mapPath: string | null) => void) => { board.add(listener); return () => { board.delete(listener); }; },
      gmCamera: {
        camera: (mapPath: string) => (mapPath === 'm.atlasmap' ? pose : null),
        onChange: (listener: () => void) => { camera.add(listener); return () => { camera.delete(listener); }; },
      },
      ...overrides,
    },
    boardChanged: (mapPath: string | null) => { for (const listener of [...board]) listener(mapPath); },
    cameraMoved: (next: unknown) => { pose = next; for (const listener of [...camera]) listener(); },
    board,
    camera,
  };
}

describe('tabletopBoard', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('without Tabletop nothing is available and no map has a look', () => {
    const { app } = fakeApp();
    const board = tabletopBoard(app);
    expect(board.available()).toBe(false);
    expect(board.lookFor('m.atlasmap')).toBeNull();
    expect(board.camera('m.atlasmap')).toBeNull();
  });

  it('pairs only with a Tabletop of the same fusion step, and says once when it is not', () => {
    expect(FUSION_PROTOCOL).toBe(3);
    const notices: string[] = [];
    const paired = fakeApp();
    paired.plugins['atlas-vtt-tabletop'] = { api: fakeTabletop().api };
    expect(tabletopBoard(paired.app, (message) => notices.push(message)).available()).toBe(true);
    expect(notices).toEqual([]);
    for (const fusion of [undefined, 1, 2]) {
      const { app, plugins } = fakeApp();
      plugins['atlas-vtt-tabletop'] = { api: fakeTabletop({ fusion }).api };
      const heard: string[] = [];
      const board = tabletopBoard(app, (message) => heard.push(message));
      expect(board.available()).toBe(false);
      expect(board.lookFor('m.atlasmap')).toBeNull();
      expect(board.available()).toBe(false);
      expect(heard).toEqual(['Tabletop for Atlas VTT 1.3.0 and Connect for Atlas VTT 0.9.0 do not match: update both to the same release.']);
    }
  });

  it('the wire contract Tabletop is generated from imports nothing', () => {
    const source = readFileSync(path.resolve(__dirname, '../../../src/app/online/scene/boardTypes.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bfrom\s+['"]/);
  });

  it('a Tabletop without the board members (an older one) is not available', () => {
    const { app, plugins } = fakeApp();
    plugins['atlas-vtt-tabletop'] = { api: { version: 1, placementsFor: () => ({}), onChange: () => () => undefined } };
    expect(tabletopBoard(app).available()).toBe(false);
  });

  it('reads the look and the camera through, and tells when Tabletop arrives, a look changes or the camera moves', () => {
    const { app, plugins, trigger } = fakeApp();
    const board = tabletopBoard(app);
    const heard = vi.fn();
    board.subscribe(heard);
    const moved = vi.fn();
    board.subscribeCamera(moved);
    const tabletop = fakeTabletop();
    plugins['atlas-vtt-tabletop'] = { api: tabletop.api };
    trigger('atlas-vtt-tabletop:api-ready', tabletop.api);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(board.available()).toBe(true);
    expect(board.lookFor('m.atlasmap')?.wallHeight('w')).toBe(2);
    expect(board.camera('m.atlasmap')).toEqual({ eye: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } });
    tabletop.boardChanged('m.atlasmap');
    expect(heard).toHaveBeenCalledTimes(2);
    tabletop.cameraMoved({ eye: { x: 9, y: 9, z: 9 }, target: { x: 1, y: 0, z: 1 } });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(moved).toHaveBeenCalledTimes(1);
    expect(board.camera('m.atlasmap')?.eye.x).toBe(9);
    board.dispose();
    expect(tabletop.board.size + tabletop.camera.size).toBe(0);
  });

  it('a broken camera is no camera; a throwing look is no look, and nothing throws', () => {
    const { app, plugins } = fakeApp();
    const tabletop = fakeTabletop({ boardLook: () => { throw new Error('boom'); } });
    plugins['atlas-vtt-tabletop'] = { api: tabletop.api };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const board = tabletopBoard(app);
    expect(board.lookFor('m.atlasmap')).toBeNull();
    tabletop.cameraMoved({ eye: { x: Number.NaN, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } });
    expect(board.camera('m.atlasmap')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('hands the GM session to Tabletop, again when Tabletop reloads, and takes it back', () => {
    const { app, plugins, trigger } = fakeApp();
    const attached: unknown[] = [];
    const released: unknown[] = [];
    const make = () => fakeTabletop({ attachSession: (session: unknown) => { attached.push(session); return () => released.push(session); } });
    const first = make();
    plugins['atlas-vtt-tabletop'] = { api: first.api };
    const board = tabletopBoard(app);
    const session = { hosting: () => true } as never;
    const release = board.attachSession(session);
    expect(attached).toEqual([session]);
    const second = make();
    plugins['atlas-vtt-tabletop'] = { api: second.api };
    trigger('atlas-vtt-tabletop:api-ready', second.api);
    expect(attached).toEqual([session, session]);
    expect(released).toEqual([session]);
    release();
    expect(released).toEqual([session, session]);
    trigger('atlas-vtt-tabletop:api-ready', make().api);
    expect(attached).toHaveLength(2);
  });

  describe('the cutscene Tabletop publishes', () => {
    const pose = { x: 1, y: 2, z: 3 };
    const goodRun = (extra: Record<string, unknown> = {}) => ({
      cutscene: {
        runId: 'r1', mode: 'prepared', look: { bars: 2.39, fadeMs: 600 }, key: 'k1', step: { shot: 0, seq: 1 },
        shots: [{ key: 'k1', eye: pose, target: pose, at: 0, keyframe: false, transition: 'fade', secret: 'x' }],
      },
      maps: { k1: 'maps/crypt.atlasmap' },
      ...extra,
    });
    function withCutscene(initial: unknown) {
      const { app, plugins, trigger } = fakeApp();
      let run = initial;
      const changes = new Set<() => void>();
      const cameras = new Set<() => void>();
      let pose3: unknown = { eye: pose, target: pose };
      const tabletop = fakeTabletop({
        cutscene: {
          current: () => { if (run === 'throw') throw new Error('boom'); return run; },
          onChange: (listener: () => void) => { changes.add(listener); return () => { changes.delete(listener); }; },
          camera: () => pose3,
          onCamera: (listener: () => void) => { cameras.add(listener); return () => { cameras.delete(listener); }; },
        },
      });
      plugins['atlas-vtt-tabletop'] = { api: tabletop.api };
      const board = tabletopBoard(app);
      return {
        app, plugins, trigger, board, tabletop, changes, cameras,
        set: (next: unknown) => { run = next; for (const listener of [...changes]) listener(); },
        setCamera: (next: unknown) => { pose3 = next; },
      };
    }

    it('reads a run field by field, without what the wire does not carry', () => {
      const w = withCutscene(goodRun());
      const read = w.board.cutscene?.();
      expect(read?.maps).toEqual({ k1: 'maps/crypt.atlasmap' });
      expect(read?.cutscene.shots[0]).toEqual({ key: 'k1', eye: pose, target: pose, at: 0, keyframe: false, transition: 'fade' });
      expect(JSON.stringify(read?.cutscene)).not.toContain('atlasmap');
    });

    it('reads a malformed run as none: 201 shots, a bad key, a bad map key, a camera at 1e8', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const run = goodRun();
      const shot = run.cutscene.shots[0]!;
      const w = withCutscene({ ...run, cutscene: { ...run.cutscene, shots: Array.from({ length: 201 }, () => shot) } });
      expect(w.board.cutscene?.()).toBeNull();
      w.set({ ...run, cutscene: { ...run.cutscene, key: 'k/1' } });
      expect(w.board.cutscene?.()).toBeNull();
      w.set({ ...run, maps: { 'k/1': 'maps/a.atlasmap' } });
      expect(w.board.cutscene?.()).toBeNull();
      w.set({ ...run, maps: { __proto__x: 'p' } });
      expect(w.board.cutscene?.()).toBeNull();
      w.set(run);
      expect(w.board.cutscene?.()).not.toBeNull();
      w.setCamera({ eye: { x: 1e400, y: 0, z: 0 }, target: pose });
      expect(w.board.cutsceneCamera?.()).toBeNull();
      warn.mockRestore();
    });

    it('a map name like __proto__ does not pollute', () => {
      const w = withCutscene(goodRun({ maps: JSON.parse('{"__proto__":"x","k1":"maps/crypt.atlasmap"}') as Record<string, string> }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(w.board.cutscene?.()).toBeNull();
      expect(({} as Record<string, unknown>).x).toBeUndefined();
      warn.mockRestore();
    });

    it('tells when the run changes and when its camera moves; a throwing current() is none', () => {
      const w = withCutscene(goodRun());
      const heard = vi.fn();
      const moved = vi.fn();
      w.board.subscribeCutscene?.(heard);
      w.board.subscribeCutsceneCamera?.(moved);
      w.set(goodRun());
      expect(heard).toHaveBeenCalledTimes(1);
      for (const listener of [...w.cameras]) listener();
      expect(moved).toHaveBeenCalledTimes(1);
      expect(w.board.cutsceneCamera?.()).toEqual({ eye: pose, target: pose });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      w.set('throw');
      expect(w.board.cutscene?.()).toBeNull();
      warn.mockRestore();
    });

    it('api.cutscene going away, or Tabletop unloading, ends the run: the listeners hear and cutscene() is null', () => {
      const w = withCutscene(goodRun());
      const heard = vi.fn();
      w.board.subscribeCutscene?.(heard);
      expect(w.board.cutscene?.()).not.toBeNull();
      // Tabletop reloads without a cutscene member.
      const other = fakeTabletop();
      w.plugins['atlas-vtt-tabletop'] = { api: other.api };
      w.trigger('atlas-vtt-tabletop:api-ready', other.api);
      expect(heard).toHaveBeenCalled();
      expect(w.board.cutscene?.()).toBeNull();
      expect(w.changes.size).toBe(0);
      // And disposing ends it too.
      const again = withCutscene(goodRun());
      const heardAgain = vi.fn();
      again.board.subscribeCutscene?.(heardAgain);
      again.board.dispose();
      expect(heardAgain).toHaveBeenCalled();
      expect(again.board.cutscene?.()).toBeNull();
      expect(again.changes.size + again.cameras.size).toBe(0);
    });

    it('a Tabletop without api.cutscene has no run', () => {
      const { app, plugins } = fakeApp();
      plugins['atlas-vtt-tabletop'] = { api: fakeTabletop().api };
      expect(tabletopBoard(app).cutscene?.()).toBeNull();
    });
  });

  it('finds Tabletop under its new id and hears its new event, as under the old', () => {
    const { app, plugins, trigger } = fakeApp();
    const board = tabletopBoard(app);
    const heard = vi.fn();
    board.subscribe(heard);
    const tabletop = fakeTabletop();
    plugins['tabletop-for-atlas'] = { api: tabletop.api };
    trigger('tabletop-for-atlas:api-ready', tabletop.api);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(board.available()).toBe(true);
  });
});
