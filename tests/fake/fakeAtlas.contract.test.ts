import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

const source = JSON.parse(readFileSync('vendor/atlas/SOURCE.json', 'utf8')) as { contractCases: string[] };
/** Cases only Atlas can show (rendering, Atlas's own UI); each with why the fake leaves it out. */
export const ATLAS_ONLY: Record<string, string> = {
  'C-life-4': 'Atlas-internal DisposerSet; the fake disposers are trivially idempotent',
};

describe('FakeAtlas follows the contract cases', () => {
  it('C-life-1: connecting again with the same id disposes the first connection', () => {
    const atlas = new FakeAtlas();
    const plugin = connectingPlugin('x');
    const listener = vi.fn();
    atlas.connect(plugin).on('unload', listener);
    atlas.connect(plugin);
    expect(atlas.listenerCount()).toBe(0);
    atlas.unload();
    expect(listener).not.toHaveBeenCalled();
    expect(atlas.connectedIds).toEqual(['x', 'x']);
  });
  it('C-life-2: unloading the extension leaves no listener behind', () => {
    const atlas = new FakeAtlas();
    const plugin = connectingPlugin('x');
    const listener = vi.fn();
    atlas.connect(plugin).on('unload', listener);
    expect(atlas.listenerCount()).toBe(1);
    plugin.unload();
    expect(atlas.listenerCount()).toBe(0);
    atlas.unload();
    expect(listener).not.toHaveBeenCalled();
  });
  it('C-life-2: an old plugin object unloading does not tear down a newer one with the same id', () => {
    const atlas = new FakeAtlas();
    const oldPlugin = connectingPlugin('x');
    const newPlugin = connectingPlugin('x');
    atlas.connect(oldPlugin);
    atlas.connect(newPlugin).on('unload', () => undefined);
    oldPlugin.unload();
    expect(atlas.listenerCount()).toBe(1);
    newPlugin.unload();
    expect(atlas.listenerCount()).toBe(0);
  });
  it('C-life-3: Atlas unloading tells every extension in order, disposes everything, then triggers api-unload', () => {
    const triggered: string[] = [];
    const atlas = new FakeAtlas({ trigger: (name) => triggered.push(name) });
    const order: string[] = [];
    atlas.connect(connectingPlugin('a')).on('unload', () => order.push('a'));
    atlas.connect(connectingPlugin('b')).on('unload', () => order.push('b'));
    atlas.unload();
    expect(order).toEqual(['a', 'b']);
    expect(atlas.listenerCount()).toBe(0);
    expect(triggered).toEqual(['atlas-vtt:api-unload']);
    expect(() => atlas.connect(connectingPlugin('c'))).toThrow(/unloaded/);
  });
  it('C-life-5: has() is true only for landed capabilities', () => {
    const atlas = new FakeAtlas({ capabilities: ['views'] });
    expect(atlas.has('views')).toBe(true);
    expect(atlas.has('remote-view')).toBe(false);
    expect(atlas.has('nonsense' as never)).toBe(false);
  });

  it('every case Atlas pins is tested here or listed as Atlas-only', () => {
    const text = readFileSync('tests/fake/fakeAtlas.contract.test.ts', 'utf8');
    const tested = new Set([...text.matchAll(/^\s*it\('(C-[a-z]+-[0-9]+):/gm)].map((match) => match[1]));
    const missing = source.contractCases.filter((id) => !ATLAS_ONLY[id] && !tested.has(id));
    expect(missing).toEqual([]);
    expect(Object.keys(ATLAS_ONLY).filter((id) => !source.contractCases.includes(id))).toEqual([]);
  });
});
