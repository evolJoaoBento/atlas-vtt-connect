import { describe, expect, it, vi } from 'vitest';
import { partyScenes, SavedSceneTokens, savedTokens } from '../../../src/connect/stockParty/savedScene';

const FILE = JSON.stringify({
  state: { schema: 'atlas-vtt', mapPath: 'maps/inn.atlasmap', objects: { tokens: {
    tok_a: { x: 1, y: 2, imagePath: 'art/fighter.webp', kind: 'character', assetId: 'token-1' },
    tok_b: { x: 3, y: 4, imagePath: 'art/orc.webp' },
    bad: 5,
  } } },
  version: 4,
});

describe("a map's saved tokens, for Controlled by without Atlas's view", () => {
  it('reads the tokens of a saved .atlasmap by id, and nothing from what is no map', () => {
    expect(savedTokens(FILE)).toEqual({ tok_a: { assetId: 'token-1', imagePath: 'art/fighter.webp' }, tok_b: { imagePath: 'art/orc.webp' } });
    expect(savedTokens('not json')).toBeNull();
    expect(savedTokens(JSON.stringify({ state: {} }))).toBeNull();
  });

  it('reads a file once, tells when it landed, and again after it changed', async () => {
    const read = vi.fn(async () => FILE);
    const ready = vi.fn();
    const saved = new SavedSceneTokens(read, ready);
    expect(saved.get('maps/inn.atlasmap')).toBeNull();
    expect(saved.get('maps/inn.atlasmap')).toBeNull();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    expect(Object.keys(saved.get('maps/inn.atlasmap') ?? {})).toEqual(['tok_a', 'tok_b']);
    expect(read).toHaveBeenCalledTimes(1);
    saved.changed('maps/inn.atlasmap');
    expect(saved.get('maps/inn.atlasmap')).toBeNull();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it("takes each map once: Atlas's loaded view as it is, the presented map and Tabletop's boards from their file", () => {
    const live = [{ mapPath: 'maps/cave.atlasmap', tokens: { c: { assetId: 'x' } } }, { mapPath: null, tokens: { l: {} } }];
    const scenes = partyScenes(live, ['maps/inn.atlasmap', 'maps/cave.atlasmap', 'maps/inn.atlasmap', 'maps/gone.atlasmap'],
      (path) => (path === 'maps/inn.atlasmap' ? { i: {} } : null));
    expect(scenes).toEqual([
      { mapPath: 'maps/cave.atlasmap', tokens: { c: { assetId: 'x' } }, live: true },
      { mapPath: null, tokens: { l: {} }, live: false },
      { mapPath: 'maps/inn.atlasmap', tokens: { i: {} }, live: false },
    ]);
  });
});
