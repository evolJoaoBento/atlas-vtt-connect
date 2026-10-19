import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { tabletopMinis } from '../../../src/connect/tabletopMinis';

/** Just enough of Obsidian's app: the plugins map and workspace events. */
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
  return { app: app as unknown as App, plugins, trigger: app.workspace.trigger, handlers };
}

function fakeTabletop(placements: Record<string, Record<string, unknown>>) {
  const listeners = new Set<(mapPath: string | null) => void>();
  return {
    api: {
      version: 1,
      placementsFor: (mapPath: string) => placements[mapPath] ?? {},
      onChange: (listener: (mapPath: string | null) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    change: (mapPath: string | null) => { for (const listener of [...listeners]) listener(mapPath); },
    listeners,
  };
}

describe('tabletopMinis', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('reads the minis of a Tabletop loaded first, and passes on its changes', () => {
    const { app, plugins } = fakeApp();
    const tabletop = fakeTabletop({ 'maps/a.md': { t1: { mini: 'minis/orc.glb', scale: 2, turn: 45 } } });
    plugins['atlas-vtt-tabletop'] = { api: tabletop.api };
    const minis = tabletopMinis(app);
    expect(minis.forMap('maps/a.md')).toEqual({ t1: { mini: 'minis/orc.glb', scale: 2, turn: 45 } });
    expect(minis.forMap('maps/b.md')).toEqual({});
    const heard = vi.fn();
    minis.subscribe(heard);
    tabletop.change('maps/a.md');
    expect(heard).toHaveBeenCalledTimes(1);
    minis.dispose();
    expect(tabletop.listeners.size).toBe(0);
  });

  it('binds to a Tabletop loaded later, and lets go when it unloads', () => {
    const { app, plugins, trigger } = fakeApp();
    const minis = tabletopMinis(app);
    const heard = vi.fn();
    minis.subscribe(heard);
    expect(minis.forMap('maps/a.md')).toEqual({});
    const tabletop = fakeTabletop({ 'maps/a.md': { t1: { mini: 'm.glb', scale: 1, turn: 0 } } });
    plugins['atlas-vtt-tabletop'] = { api: tabletop.api };
    trigger('atlas-vtt-tabletop:api-ready', tabletop.api);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(Object.keys(minis.forMap('maps/a.md'))).toEqual(['t1']);
    trigger('atlas-vtt-tabletop:api-unload');
    delete plugins['atlas-vtt-tabletop'];
    vi.runAllTimers();
    expect(heard).toHaveBeenCalledTimes(2);
    expect(minis.forMap('maps/a.md')).toEqual({});
    expect(tabletop.listeners.size).toBe(0);
  });

  it('drops malformed placements and ignores an API it does not know', () => {
    const { app, plugins } = fakeApp();
    plugins['atlas-vtt-tabletop'] = { api: fakeTabletop({ m: { a: { mini: '' }, b: null, c: { mini: 'x.glb', scale: 'big' }, __proto__: { mini: 'p.glb' } } }).api };
    expect(tabletopMinis(app).forMap('m')).toEqual({ c: { mini: 'x.glb', scale: 1, turn: 0 } });
    plugins['atlas-vtt-tabletop'] = { api: { version: 2, placementsFor: () => ({ t: { mini: 'x.glb' } }), onChange: () => () => undefined } };
    expect(tabletopMinis(app).forMap('m')).toEqual({});
  });
});
