import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { tabletopBoard } from '../../../src/connect/tabletopMinis';

function fakeApp() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const plugins: Record<string, { api?: unknown }> = {};
  const app = {
    plugins: { plugins },
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
