import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

const source = JSON.parse(readFileSync('vendor/atlas/SOURCE.json', 'utf8')) as { contractCases: string[] };
/** Cases only Atlas can show (rendering, Atlas's own UI); each with why the fake leaves it out. */
export const ATLAS_ONLY: Record<string, string> = {
  'C-life-4': 'Atlas-internal DisposerSet; the fake disposers are trivially idempotent',
};

describe('FakeAtlas follows the contract cases', () => {
  it('C-life-1: a second connect with the same id gets a fresh scope', () => {
    const atlas = new FakeAtlas();
    atlas.connect(connectingPlugin('x'));
    atlas.connect(connectingPlugin('x'));
    expect(atlas.connectedIds).toEqual(['x', 'x']);
  });
  it('C-life-3: unload tells the extension, then nothing is left', () => {
    const atlas = new FakeAtlas();
    let told = false;
    atlas.connect(connectingPlugin('x')).on('unload', () => { told = true; });
    atlas.unload();
    expect(told).toBe(true);
    expect(atlas.listenerCount()).toBe(0);
  });
  it('C-life-5: has() answers only for given capabilities', () => {
    expect(new FakeAtlas({ capabilities: ['views'] }).has('dice')).toBe(false);
  });
  it('C-life-2: a disposer removes its listener', () => {
    const atlas = new FakeAtlas();
    atlas.connect(connectingPlugin('x')).on('unload', () => undefined)();
    expect(atlas.listenerCount()).toBe(0);
  });

  it('every case Atlas pins is tested here or listed as Atlas-only', () => {
    const text = readFileSync('tests/fake/fakeAtlas.contract.test.ts', 'utf8');
    const missing = source.contractCases.filter((id) => !ATLAS_ONLY[id] && !text.includes(`'${id}:`));
    expect(missing).toEqual([]);
  });
});
